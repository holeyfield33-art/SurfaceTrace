import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IdentityContext, Observation } from "@surfacetrace/core";
import { buildApp } from "../src/app.js";
import { executeReplayRequest } from "../src/replay/httpClient.js";
import { reconstructRequest } from "../src/replay/reconstruct.js";

const identities: IdentityContext[] = [
  {
    id: "account-a",
    label: "Account A",
    role: "user",
    notes: null,
    associatedObservationIds: ["baseline"],
  },
  {
    id: "privileged",
    label: "Privileged",
    role: "admin",
    notes: null,
    associatedObservationIds: [],
  },
];

describe("active replay reconstruction", () => {
  test("reconstructs path, query, header, and body mutations one at a time", () => {
    const baseline = observation();
    expect(
      reconstructRequest(
        baseline,
        { pathParam: { name: "id", from: "100", to: "101" } },
        identities,
        new Map(),
      ).url,
    ).toContain("/items/101");
    expect(
      reconstructRequest(
        baseline,
        { queryParam: { name: "view", from: "full", to: "brief" } },
        identities,
        new Map(),
      ).url,
    ).toContain("view=brief");
    expect(
      reconstructRequest(
        baseline,
        { header: { name: "X-Mode", from: "safe", to: "review" } },
        identities,
        new Map(),
      ).headers["X-Mode"],
    ).toBe("review");
    expect(
      reconstructRequest(
        baseline,
        { bodyField: { path: "profile.mode", from: "safe", to: "review" } },
        identities,
        new Map(),
      ).body,
    ).toBe('{"profile":{"mode":"review"}}');
  });

  test("rejects zero, multiple, mismatched, and unavailable identity mutations", () => {
    expect(() =>
      reconstructRequest(observation(), {}, identities, new Map()),
    ).toThrow("exactly one variable");
    expect(() =>
      reconstructRequest(
        observation(),
        {
          pathParam: { name: "id", from: "100", to: "101" },
          queryParam: { name: "view", from: "full", to: "brief" },
        },
        identities,
        new Map(),
      ),
    ).toThrow("exactly one variable");
    expect(() =>
      reconstructRequest(
        observation(),
        { pathParam: { name: "id", from: "999", to: "101" } },
        identities,
        new Map(),
      ),
    ).toThrow("baseline value was not found");
    expect(() =>
      reconstructRequest(
        observation({ identityId: "account-a" }),
        { identity: { fromRole: "user", toRole: "admin" } },
        identities,
        new Map(),
        "privileged",
      ),
    ).toThrow("credentials are unavailable");
  });

  test("uses explicit runtime identity material but redacts it from preview", () => {
    const credentials = new Map([
      [
        "privileged",
        {
          headers: { Authorization: "Bearer runtime-only-secret" },
          cookies: { session: "runtime-cookie" },
        },
      ],
    ]);
    const result = reconstructRequest(
      observation({ identityId: "account-a" }),
      { identity: { fromRole: "user", toRole: "admin" } },
      identities,
      credentials,
      "privileged",
    );
    expect(result.headers.Authorization).toContain("runtime-only-secret");
    expect(result.preview).not.toContain("runtime-only-secret");
    expect(result.preview).not.toContain("runtime-cookie");
  });
});

describe("dedicated replay HTTP client", () => {
  let server: Server;
  let baseUrl: string;
  let requests = 0;

  beforeAll(async () => {
    server = createServer((request, response) => {
      requests += 1;
      if (request.url === "/redirect") {
        response.writeHead(302, { Location: "/final" }).end();
        return;
      }
      if (request.url === "/slow") {
        setTimeout(() => response.end("late"), 150);
        return;
      }
      if (request.url === "/large") {
        response.end("x".repeat(256));
        return;
      }
      response.setHeader("Content-Type", "application/json");
      response.setHeader("Set-Cookie", "session=response-secret");
      response.end('{"ok":true,"password":"response-secret"}');
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  test("does not follow redirects or retry", async () => {
    const before = requests;
    const response = await executeReplayRequest({
      method: "GET",
      url: `${baseUrl}/redirect`,
      headers: {},
      body: null,
    });
    expect(response.status).toBe(302);
    expect(response.redirectLocation).toBe(`${baseUrl}/final`);
    expect(requests - before).toBe(1);
  });

  test("times out once without retrying", async () => {
    const before = requests;
    await expect(
      executeReplayRequest(
        { method: "GET", url: `${baseUrl}/slow`, headers: {}, body: null },
        { timeoutMs: 20 },
      ),
    ).rejects.toThrow("timeout");
    expect(requests - before).toBe(1);
  });

  test("limits response bytes and redacts response secrets", async () => {
    const large = await executeReplayRequest(
      { method: "GET", url: `${baseUrl}/large`, headers: {}, body: null },
      { maxResponseBytes: 32 },
    );
    expect(large).toMatchObject({ size: 32, truncated: true });
    const safe = await executeReplayRequest({
      method: "GET",
      url: `${baseUrl}/safe`,
      headers: {},
      body: null,
    });
    expect(JSON.stringify(safe)).not.toContain("response-secret");
    expect(safe.body).toContain("[REDACTED]");
  });

  test("requires preview, approval, one-time send, and restores replay after restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "surfacetrace-replay-"));
    const dbPath = join(directory, "replay.db");
    let first: ReturnType<typeof buildApp> | null = null;
    let second: ReturnType<typeof buildApp> | null = null;
    try {
      first = buildApp({ logger: false, dbPath });
      await first.inject({
        method: "POST",
        url: "/import/har",
        payload: { har: replayHar(`${baseUrl}/items/100?view=full`) },
      });
      const inventory = (
        await first.inject({ method: "GET", url: "/inventory" })
      ).json();
      const baseline = inventory.observations[0];
      const port = Number(new URL(baseUrl).port);
      await first.inject({
        method: "PUT",
        url: "/scope",
        payload: scopeConfig(port),
      });
      const before = requests;
      const prepared = await first.inject({
        method: "POST",
        url: "/replay/prepare",
        payload: {
          baselineObservationId: baseline.id,
          mutation: { pathParam: { name: "id", from: "100", to: "101" } },
        },
      });
      expect(prepared.json()).toMatchObject({
        approvalRequired: true,
        networkRequests: 0,
        scopeDecision: { allowed: true },
      });
      expect(requests).toBe(before);
      const token = prepared.json().token;
      expect(
        (
          await first.inject({
            method: "POST",
            url: `/replay/${token}/send`,
            payload: { approval: false },
          })
        ).statusCode,
      ).toBe(400);
      expect(requests).toBe(before);
      const sent = await first.inject({
        method: "POST",
        url: `/replay/${token}/send`,
        payload: { approval: true },
      });
      expect(sent.statusCode).toBe(200);
      expect(sent.json()).toMatchObject({
        networkRequests: 1,
        retries: 0,
        ledgerValid: true,
        experiment: { replay: { active: true } },
      });
      expect(requests - before).toBe(1);
      expect(
        (
          await first.inject({
            method: "POST",
            url: `/replay/${token}/send`,
            payload: { approval: true },
          })
        ).statusCode,
      ).toBe(404);
      expect(requests - before).toBe(1);
      const evidence = (
        await first.inject({ method: "GET", url: "/evidence" })
      ).json();
      expect(
        evidence.records.map(
          (item: { payload: { event?: string } }) => item.payload.event,
        ),
      ).toEqual(
        expect.arrayContaining([
          "replay_prepared",
          "replay_scope_decision",
          "replay_human_approval",
          "replay_request_sent",
          "replay_response_received",
          "replay_diff_created",
        ]),
      );
      await first.close();
      first = null;
      second = buildApp({ logger: false, dbPath });
      const restored = (
        await second.inject({ method: "GET", url: "/inventory" })
      ).json();
      expect(restored.experiments).toHaveLength(1);
      expect(restored.experiments[0]).toMatchObject({
        replay: { active: true },
      });
      expect(restored.observations).toHaveLength(2);
      expect(
        (await second.inject({ method: "GET", url: "/evidence" })).json(),
      ).toEqual(evidence);
    } finally {
      if (first) await first.close();
      if (second) await second.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }, 15_000);

  test("all pre-send safety failures produce zero network requests", async () => {
    const app = buildApp({ logger: false });
    await app.inject({
      method: "POST",
      url: "/import/har",
      payload: { har: replayHar(`${baseUrl}/items/100?view=full`) },
    });
    const baseline = (
      await app.inject({ method: "GET", url: "/inventory" })
    ).json().observations[0];
    const mutation = {
      pathParam: { name: "id", from: "100", to: "101" },
    };
    const before = requests;
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/replay/prepare",
          payload: { baselineObservationId: baseline.id, mutation },
        })
      ).json().token,
    ).toBeNull();
    expect(requests).toBe(before);
    const port = Number(new URL(baseUrl).port);
    await app.inject({
      method: "PUT",
      url: "/scope",
      payload: { ...scopeConfig(port), allowedHosts: ["other.test"] },
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/replay/prepare",
          payload: { baselineObservationId: baseline.id, mutation },
        })
      ).json().token,
    ).toBeNull();
    expect(requests).toBe(before);
    await app.inject({
      method: "PUT",
      url: "/scope",
      payload: { ...scopeConfig(port), allowedPorts: [port + 1] },
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/replay/prepare",
          payload: { baselineObservationId: baseline.id, mutation },
        })
      ).json().token,
    ).toBeNull();
    expect(requests).toBe(before);
    await app.inject({
      method: "PUT",
      url: "/scope",
      payload: { ...scopeConfig(port), maxRequestsPerMinute: 1 },
    });
    const cancellable = (
      await app.inject({
        method: "POST",
        url: "/replay/prepare",
        payload: { baselineObservationId: baseline.id, mutation },
      })
    ).json();
    expect(cancellable.token).toBeTruthy();
    await app.inject({
      method: "POST",
      url: `/replay/${cancellable.token}/cancel`,
    });
    expect(requests).toBe(before);
    const approved = (
      await app.inject({
        method: "POST",
        url: "/replay/prepare",
        payload: { baselineObservationId: baseline.id, mutation },
      })
    ).json();
    await app.inject({
      method: "POST",
      url: `/replay/${approved.token}/send`,
      payload: { approval: true },
    });
    expect(requests).toBe(before + 1);
    const afterBudgetRequest = requests;
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/replay/prepare",
          payload: { baselineObservationId: baseline.id, mutation },
        })
      ).json().token,
    ).toBeNull();
    expect(requests).toBe(afterBudgetRequest);
    await app.inject({
      method: "PUT",
      url: "/scope",
      payload: {
        ...scopeConfig(port),
        stopConditions: {
          ...scopeConfig(port).stopConditions,
          manualStop: true,
        },
      },
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/replay/prepare",
          payload: { baselineObservationId: baseline.id, mutation },
        })
      ).json().token,
    ).toBeNull();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/replay/prepare",
          payload: { baselineObservationId: baseline.id, mutation: {} },
        })
      ).statusCode,
    ).toBe(400);
    expect(requests).toBe(afterBudgetRequest);
    await app.close();
  });
});

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    id: "baseline",
    endpointId: "endpoint",
    method: "POST",
    url: "http://example.test/items/100?view=full",
    pathTemplate: "/items/{id}",
    requestHeaders: { "Content-Type": "application/json", "X-Mode": "safe" },
    requestBodyShape: '{"profile":{"mode":"safe"}}',
    responseStatus: 200,
    responseHeaders: { "Content-Type": "application/json" },
    responseBodyShape: '{"id":100}',
    responseSize: 10,
    capturedAt: "now",
    redacted: true,
    contentHash: "hash",
    http: {
      request: {
        httpVersion: "HTTP/1.1",
        target: "/items/100?view=full",
        headers: { "Content-Type": "application/json", "X-Mode": "safe" },
        cookies: {},
        query: { view: "full" },
        body: '{"profile":{"mode":"safe"}}',
      },
      response: {
        httpVersion: "HTTP/1.1",
        status: 200,
        statusText: "OK",
        headers: { "Content-Type": "application/json" },
        body: '{"id":100}',
      },
    },
    parsedInputs: [],
    identityId: null,
    ...overrides,
  };
}

function replayHar(url: string): string {
  return JSON.stringify({
    log: {
      version: "1.2",
      creator: { name: "replay-test", version: "1" },
      entries: [
        {
          startedDateTime: "2026-01-01T00:00:00.000Z",
          time: 1,
          request: {
            method: "GET",
            url,
            headers: [],
            queryString: [],
            cookies: [],
          },
          response: {
            status: 200,
            statusText: "OK",
            headers: [{ name: "Content-Type", value: "application/json" }],
            content: {
              size: 10,
              mimeType: "application/json",
              text: '{"id":100}',
            },
          },
        },
      ],
    },
  });
}

function scopeConfig(port: number) {
  return {
    active: true,
    allowedHosts: ["127.0.0.1"],
    allowedProtocols: ["http"],
    allowedPorts: [port],
    allowedPathPrefixes: ["/items/"],
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
