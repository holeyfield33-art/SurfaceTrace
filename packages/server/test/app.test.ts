import { readFileSync } from "node:fs";
import { buildApp } from "../src/app.js";

const sample = readFileSync("../../fixtures/sample.har", "utf8");

describe("local API trust boundary", () => {
  test("allows configured local CORS origins", async () => {
    const app = buildApp({ logger: false });
    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "http://localhost:5173" },
    });
    expect(response.headers["access-control-allow-origin"]).toBe(
      "http://localhost:5173",
    );
    await app.close();
  });

  test("does not grant CORS access to arbitrary origins", async () => {
    const app = buildApp({ logger: false });
    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://untrusted.example" },
    });
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    await app.close();
  });

  test("rejects request bodies beyond the configured byte limit", async () => {
    const app = buildApp({ logger: false, maxBodyBytes: 128 });
    const response = await app.inject({
      method: "POST",
      url: "/import/har",
      payload: { har: "x".repeat(256) },
    });
    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({ error: "HAR upload exceeds 128 bytes" });
    await app.close();
  });

  test("rejects HARs beyond the configured entry limit", async () => {
    const app = buildApp({ logger: false, maxHarEntries: 1 });
    const response = await app.inject({
      method: "POST",
      url: "/import/har",
      payload: { har: sample },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("maximum is 1");
    await app.close();
  });

  test("keeps valid entries when another entry is malformed", async () => {
    const har = JSON.parse(sample) as { log: { entries: unknown[] } };
    har.log.entries = [
      har.log.entries[0],
      { request: { method: "GET", url: "bad" }, response: {} },
    ];
    const app = buildApp({ logger: false });
    const response = await app.inject({
      method: "POST",
      url: "/import/har",
      payload: { har: JSON.stringify(har) },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      observations: 1,
      skippedEntries: 1,
    });
    await app.close();
  });

  test("returns sanitized inventory and evidence", async () => {
    const app = buildApp({ logger: false });
    await app.inject({
      method: "POST",
      url: "/import/har",
      payload: { har: sample },
    });
    const response = await app.inject({ method: "GET", url: "/inventory" });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("token=abc");
    expect(response.body).not.toContain("fixture-cookie-secret-do-not-store");
    expect(response.body).not.toContain("secret-token-do-not-store");
    expect(response.body).not.toContain("should-be-redacted");
    await app.close();
  });

  test("creates an experiment, diff, and chained evidence records", async () => {
    const app = buildApp({ logger: false });
    await app.inject({
      method: "POST",
      url: "/import/har",
      payload: { har: sample },
    });
    const inventory = (
      await app.inject({ method: "GET", url: "/inventory" })
    ).json();
    const endpoint = inventory.endpoints.find(
      (item: { pathTemplate: string }) =>
        item.pathTemplate === "/api/projects/{id}",
    );
    const observations = inventory.observations.filter(
      (item: { endpointId: string }) => item.endpointId === endpoint.id,
    );
    const hypothesis = inventory.hypotheses.find(
      (item: { endpointId: string }) => item.endpointId === endpoint.id,
    );
    const input = inventory.inputs.find(
      (item: { endpointId: string; location: string }) =>
        item.endpointId === endpoint.id && item.location === "path",
    );
    const response = await app.inject({
      method: "POST",
      url: "/experiments",
      payload: {
        endpointId: endpoint.id,
        hypothesisId: hypothesis.id,
        inputId: input.id,
        baselineObservationId: observations[0].id,
        resultObservationId: observations[1].id,
        mutation: { pathParam: { name: input.name, from: "100", to: "200" } },
        notes: "Compare two imported, authorized observations",
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      experiment: {
        status: "investigating",
        mutationDescription: "path.id: 100 → 200",
        comparisonClassification: "observational",
        requestDifferences: ["header.cookie"],
      },
      diff: { lengthDelta: -2 },
      ledgerValid: true,
    });
    expect(response.json().diff.bodyChanges).toEqual([
      { path: "id", changeType: "value_changed", before: 100, after: 200 },
      {
        path: "name",
        changeType: "value_changed",
        before: "Alpha",
        after: "Beta",
      },
      {
        path: "ownerEmail",
        changeType: "value_changed",
        before: "user@example.com",
        after: "other@example.com",
      },
    ]);
    const evidence = (
      await app.inject({ method: "GET", url: "/evidence" })
    ).json();
    expect(evidence.records.map((item: { kind: string }) => item.kind)).toEqual(
      ["observation", "experiment", "diff"],
    );
    expect(evidence.valid).toBe(true);
    expect(
      evidence.records.find((item: { kind: string }) => item.kind === "diff")
        .payload.bodyChanges,
    ).toEqual(response.json().diff.bodyChanges);
    await app.close();
  });
  test("manually assigns observations to explicit identities", async () => {
    const app = buildApp({ logger: false });
    await app.inject({
      method: "POST",
      url: "/import/har",
      payload: { har: sample },
    });
    const inventory = (
      await app.inject({ method: "GET", url: "/inventory" })
    ).json();
    expect(
      inventory.identities.map((item: { label: string }) => item.label),
    ).toEqual([
      "Anonymous",
      "Account A",
      "Account B",
      "Privileged/Admin",
      "Custom",
    ]);
    const observationId = inventory.observations[0].id;
    const response = await app.inject({
      method: "PATCH",
      url: `/observations/${observationId}/identity`,
      payload: { identityId: "account-a" },
    });
    expect(response.json()).toMatchObject({
      observation: { identityId: "account-a" },
      identity: {
        label: "Account A",
        associatedObservationIds: [observationId],
      },
    });
    const changed = await app.inject({
      method: "PATCH",
      url: `/observations/${observationId}/identity`,
      payload: { identityId: "account-b" },
    });
    expect(changed.json()).toMatchObject({
      observation: { identityId: "account-b" },
      identity: { label: "Account B" },
    });
    const refreshed = (
      await app.inject({ method: "GET", url: "/inventory" })
    ).json();
    expect(
      refreshed.observations.find(
        (item: { id: string }) => item.id === observationId,
      ).identityId,
    ).toBe("account-b");
    expect(
      refreshed.identities.find(
        (item: { id: string }) => item.id === "account-a",
      ).associatedObservationIds,
    ).toEqual([]);
    await app.close();
  });

  test("lists, retrieves, and records human-controlled experiment lifecycle evidence", async () => {
    const app = buildApp({ logger: false });
    await app.inject({
      method: "POST",
      url: "/import/har",
      payload: { har: sample },
    });
    const inventory = (
      await app.inject({ method: "GET", url: "/inventory" })
    ).json();
    const endpoint = inventory.endpoints.find(
      (item: { pathTemplate: string }) =>
        item.pathTemplate === "/api/projects/{id}",
    );
    const observations = inventory.observations.filter(
      (item: { endpointId: string }) => item.endpointId === endpoint.id,
    );
    const hypothesis = inventory.hypotheses.find(
      (item: { endpointId: string }) => item.endpointId === endpoint.id,
    );
    const input = inventory.inputs.find(
      (item: { endpointId: string; location: string }) =>
        item.endpointId === endpoint.id && item.location === "path",
    );
    const created = await app.inject({
      method: "POST",
      url: "/experiments",
      payload: {
        endpointId: endpoint.id,
        hypothesisId: hypothesis.id,
        inputId: input.id,
        baselineObservationId: observations[0].id,
        resultObservationId: observations[1].id,
        mutation: { pathParam: { name: "id", from: "100", to: "200" } },
        notes: "token=private initial note",
      },
    });
    const experiment = created.json().experiment;
    expect(JSON.stringify(experiment)).not.toContain("private");
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/experiments/${experiment.id}`,
        })
      ).json(),
    ).toMatchObject({
      id: experiment.id,
      conclusion: null,
      status: "investigating",
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/experiments?status=investigating&endpointId=${endpoint.id}`,
        })
      ).json(),
    ).toHaveLength(1);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/experiments/${experiment.id}`,
          payload: { status: "confirmed_vulnerability" },
        })
      ).statusCode,
    ).toBe(400);
    const concluded = await app.inject({
      method: "PATCH",
      url: `/experiments/${experiment.id}`,
      payload: {
        conclusion: "potential_security_issue",
        notes: "password=private needs reproduction",
      },
    });
    expect(concluded.json().experiment).toMatchObject({
      conclusion: "potential_security_issue",
      notes: "password=[REDACTED] needs reproduction",
    });
    const candidate = await app.inject({
      method: "PATCH",
      url: `/experiments/${experiment.id}`,
      payload: { status: "candidate_finding" },
    });
    expect(candidate.json().experiment.status).toBe("candidate_finding");
    const closed = await app.inject({
      method: "PATCH",
      url: `/experiments/${experiment.id}`,
      payload: { status: "closed" },
    });
    expect(closed.json().experiment.status).toBe("closed");
    const evidence = (
      await app.inject({ method: "GET", url: "/evidence" })
    ).json();
    expect(evidence.valid).toBe(true);
    expect(
      evidence.records
        .slice(-4)
        .map((item: { payload: { event: string } }) => item.payload.event),
    ).toEqual([
      "conclusion_changed",
      "notes_updated",
      "candidate_finding_declared",
      "experiment_closed",
    ]);
    expect(JSON.stringify(evidence)).not.toContain("private");
    await app.close();
  });

  test("classifies a one-variable imported comparison as controlled", async () => {
    const har = JSON.parse(sample) as {
      log: { entries: Array<{ request: { cookies?: unknown[] } }> };
    };
    har.log.entries[0]!.request.cookies = [];
    const app = buildApp({ logger: false });
    await app.inject({
      method: "POST",
      url: "/import/har",
      payload: { har: JSON.stringify(har) },
    });
    const inventory = (
      await app.inject({ method: "GET", url: "/inventory" })
    ).json();
    const endpoint = inventory.endpoints.find(
      (item: { pathTemplate: string }) =>
        item.pathTemplate === "/api/projects/{id}",
    );
    const observations = inventory.observations.filter(
      (item: { endpointId: string }) => item.endpointId === endpoint.id,
    );
    const hypothesis = inventory.hypotheses.find(
      (item: { endpointId: string }) => item.endpointId === endpoint.id,
    );
    const input = inventory.inputs.find(
      (item: { endpointId: string; location: string }) =>
        item.endpointId === endpoint.id && item.location === "path",
    );
    const response = await app.inject({
      method: "POST",
      url: "/experiments",
      payload: {
        endpointId: endpoint.id,
        hypothesisId: hypothesis.id,
        inputId: input.id,
        baselineObservationId: observations[0].id,
        resultObservationId: observations[1].id,
        mutation: { pathParam: { name: "id", from: "100", to: "200" } },
      },
    });
    expect(response.json().experiment).toMatchObject({
      comparisonClassification: "controlled",
      requestDifferences: [],
    });
    await app.close();
  });

  test("rejects zero and multiple changed variables", async () => {
    const app = buildApp({ logger: false });
    await app.inject({
      method: "POST",
      url: "/import/har",
      payload: { har: sample },
    });
    const inventory = (
      await app.inject({ method: "GET", url: "/inventory" })
    ).json();
    const endpoint = inventory.endpoints.find(
      (item: { pathTemplate: string }) =>
        item.pathTemplate === "/api/projects/{id}",
    );
    const observations = inventory.observations.filter(
      (item: { endpointId: string }) => item.endpointId === endpoint.id,
    );
    const hypothesis = inventory.hypotheses.find(
      (item: { endpointId: string }) => item.endpointId === endpoint.id,
    );
    const input = inventory.inputs.find(
      (item: { endpointId: string; location: string }) =>
        item.endpointId === endpoint.id && item.location === "path",
    );
    const base = {
      endpointId: endpoint.id,
      hypothesisId: hypothesis.id,
      inputId: input.id,
      baselineObservationId: observations[0].id,
      resultObservationId: observations[1].id,
    };
    const zero = await app.inject({
      method: "POST",
      url: "/experiments",
      payload: { ...base, mutation: {} },
    });
    const multiple = await app.inject({
      method: "POST",
      url: "/experiments",
      payload: {
        ...base,
        mutation: {
          pathParam: { name: input.name, from: "100", to: "200" },
          queryParam: { name: "q", from: "a", to: "b" },
        },
      },
    });
    expect(zero.statusCode).toBe(400);
    expect(multiple.statusCode).toBe(400);
    await app.close();
  });
});
