import { readFileSync } from "node:fs";
import { buildApp } from "../src/app.js";

const sample = readFileSync("../../fixtures/sample.har", "utf8");

describe("runtime request contracts", () => {
  test("rejects malformed and unknown input without mutating state", async () => {
    const app = buildApp({ logger: false });
    try {
      const invalidRequests = [
        {
          method: "POST",
          url: "/projects",
          payload: { name: 42 },
        },
        {
          method: "POST",
          url: "/projects",
          payload: { name: "Hidden mutation", unexpected: true },
        },
        {
          method: "GET",
          url: "/projects?unexpected=true",
        },
        {
          method: "POST",
          url: "/projects/not-a-project/open",
          payload: { unexpected: true },
        },
        {
          method: "POST",
          url: "/import/har",
          payload: { har: sample, sourceLabel: 42 },
        },
        {
          method: "POST",
          url: "/import/har",
          payload: { har: sample, unexpected: true },
        },
        {
          method: "PUT",
          url: "/scope",
          payload: { ...scopeConfig(), allowedHosts: [42] },
        },
        {
          method: "PUT",
          url: "/scope",
          payload: { ...scopeConfig(), unexpected: true },
        },
        {
          method: "POST",
          url: "/scope/preview",
          payload: { url: "https://example.test/" },
        },
        {
          method: "POST",
          url: "/scope/redirect-preview",
          payload: { method: "get", redirectUrl: "https://example.test/" },
        },
        {
          method: "POST",
          url: "/scope/stops/reset",
          payload: { condition: "authenticationLost", unexpected: true },
        },
        {
          method: "POST",
          url: "/scope/budget/consume",
          payload: { unexpected: true },
        },
        {
          method: "PUT",
          url: "/replay/credentials/account-a",
          payload: { headers: { Authorization: 42 }, cookies: {} },
        },
        {
          method: "POST",
          url: "/replay/prepare",
          payload: {
            baselineObservationId: "baseline",
            mutation: {
              pathParam: { name: "id", from: "1", to: "2" },
              queryParam: { name: "q", from: "a", to: "b" },
            },
          },
        },
        {
          method: "POST",
          url: "/replay/not-a-token/send",
          payload: { approval: "true" },
        },
        {
          method: "POST",
          url: "/replay/not-a-token/cancel",
          payload: { unexpected: true },
        },
        {
          method: "PATCH",
          url: "/observations/not-an-observation/identity",
          payload: { identityId: 42 },
        },
        {
          method: "POST",
          url: "/assets",
          payload: { label: 42, category: "pii" },
        },
        {
          method: "PATCH",
          url: "/assets/not-an-asset",
          payload: {},
        },
        {
          method: "POST",
          url: "/trust-boundaries",
          payload: {
            label: "Boundary",
            type: "browser_api",
            sourceRef: 42,
            destinationRef: "endpoint",
          },
        },
        {
          method: "PATCH",
          url: "/trust-boundaries/not-a-boundary",
          payload: {},
        },
        {
          method: "PATCH",
          url: "/hypotheses/not-a-hypothesis",
          payload: {},
        },
        {
          method: "GET",
          url: "/experiments?unexpected=true",
        },
        {
          method: "PATCH",
          url: "/experiments/not-an-experiment",
          payload: { structuredConclusion: { unexpected: true } },
        },
        {
          method: "POST",
          url: "/experiments",
          payload: {
            endpointId: 42,
            hypothesisId: "hypothesis",
            baselineObservationId: "baseline",
            resultObservationId: "result",
            mutation: { identity: { fromRole: "user", toRole: "admin" } },
          },
        },
      ] as const;

      for (const request of invalidRequests) {
        const response = await app.inject(request);
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({
          error: "Request validation failed",
          code: "INVALID_REQUEST",
        });
      }
      expect(
        (await app.inject({ method: "GET", url: "/projects" })).json().projects,
      ).toHaveLength(1);
      expect((await app.inject({ method: "GET", url: "/scope" })).json()).toMatchObject({
        scope: null,
      });
      expect(
        (await app.inject({ method: "GET", url: "/inventory" })).statusCode,
      ).toBe(404);
    } finally {
      await app.close();
    }
  });

  test("allows only active inventory boundary references and emits complete graphs", async () => {
    const app = buildApp({ logger: false });
    try {
      await app.inject({
        method: "POST",
        url: "/import/har",
        payload: { har: sample },
      });
      const inventory = (
        await app.inject({ method: "GET", url: "/inventory" })
      ).json();
      const endpointId = inventory.endpoints[0].id as string;
      const unknownSource = await app.inject({
        method: "POST",
        url: "/trust-boundaries",
        payload: {
          label: "Unknown source",
          type: "browser_api",
          sourceRef: "unknown-source",
          destinationRef: endpointId,
        },
      });
      expect(unknownSource.statusCode).toBe(400);
      const unknownDestination = await app.inject({
        method: "POST",
        url: "/trust-boundaries",
        payload: {
          label: "Unknown destination",
          type: "browser_api",
          sourceRef: "browser",
          destinationRef: "unknown-endpoint",
        },
      });
      expect(unknownDestination.statusCode).toBe(400);

      const browserBoundary = await app.inject({
        method: "POST",
        url: "/trust-boundaries",
        payload: {
          label: "Browser to API",
          type: "browser_api",
          sourceRef: "browser",
          destinationRef: endpointId,
        },
      });
      expect(browserBoundary.statusCode).toBe(201);
      const identityBoundary = await app.inject({
        method: "POST",
        url: "/trust-boundaries",
        payload: {
          label: "Unassigned account to API",
          type: "public_authenticated",
          sourceRef: "account-b",
          destinationRef: endpointId,
        },
      });
      expect(identityBoundary.statusCode).toBe(201);

      const updated = (
        await app.inject({ method: "GET", url: "/inventory" })
      ).json();
      const nodeIds = new Set(
        updated.graph.nodes.map((item: { id: string }) => item.id),
      );
      expect(nodeIds.has("browser")).toBe(true);
      expect(nodeIds.has("account-b")).toBe(true);
      for (const edge of updated.graph.edges as Array<{
        source: string;
        target: string;
      }>) {
        expect(nodeIds.has(edge.source)).toBe(true);
        expect(nodeIds.has(edge.target)).toBe(true);
      }
      const invalidPatch = await app.inject({
        method: "PATCH",
        url: `/trust-boundaries/${browserBoundary.json().id}`,
        payload: { destinationRef: "unknown-endpoint" },
      });
      expect(invalidPatch.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});

function scopeConfig() {
  return {
    active: true,
    allowedHosts: ["example.test"],
    allowedProtocols: ["https"],
    allowedPorts: [443],
    allowedPathPrefixes: ["/"],
    excludedPathPrefixes: [],
    allowedMethods: ["GET"],
    maxRequestsPerMinute: 5,
    stopConditions: {
      manualStop: false,
      maxRequestCount: null,
      repeatedServerErrors: false,
      authenticationLost: false,
      customNote: null,
    },
    notes: null,
  };
}
