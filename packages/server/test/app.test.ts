import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { buildApp } from "../src/app.js";

const sample = readFileSync("../../fixtures/sample.har", "utf8");

describe("local API trust boundary", () => {
  test("requires a strong bearer token on every protected hop when configured", async () => {
    expect(() => buildApp({ logger: false, apiToken: "too-short" })).toThrow(
      "at least 32 characters",
    );
    const apiToken = "a-secure-test-token-with-32-characters";
    const app = buildApp({ logger: false, apiToken });
    const denied = await app.inject({
      method: "GET",
      url: "/projects",
      remoteAddress: "192.0.2.10",
    });
    expect(denied.statusCode).toBe(401);
    const deniedLoopback = await app.inject({
      method: "GET",
      url: "/projects",
      remoteAddress: "127.0.0.1",
    });
    expect(deniedLoopback.statusCode).toBe(401);
    const forgedForwardingHeaders = await app.inject({
      method: "GET",
      url: "/projects",
      remoteAddress: "192.0.2.10",
      headers: {
        "x-forwarded-for": "127.0.0.1",
        forwarded: "for=127.0.0.1",
      },
    });
    expect(forgedForwardingHeaders.statusCode).toBe(401);
    const allowed = await app.inject({
      method: "GET",
      url: "/projects",
      remoteAddress: "192.0.2.10",
      headers: { authorization: `Bearer ${apiToken}` },
    });
    expect(allowed.statusCode).toBe(200);
    const health = await app.inject({
      method: "GET",
      url: "/health",
      remoteAddress: "192.0.2.10",
    });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({
      ok: true,
      service: "surfacetrace-server",
      version: "0.1.0",
    });
    await app.close();
  });

  test("disables remote protected access when no authentication is configured", async () => {
    const app = buildApp({ logger: false });
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/projects",
          remoteAddress: "192.0.2.10",
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/projects",
          remoteAddress: "127.0.0.1",
        })
      ).statusCode,
    ).toBe(200);
    await app.close();
  });

  test("persists scope lifecycle and previews candidates without network activity", async () => {
    const directory = mkdtempSync(join(tmpdir(), "surfacetrace-scope-"));
    const dbPath = join(directory, "scope.db");
    const configuration = {
      active: true,
      allowedHosts: ["example.test"],
      allowedProtocols: ["https"],
      allowedPorts: [443],
      allowedPathPrefixes: ["/api/"],
      excludedPathPrefixes: ["/api/admin/"],
      allowedMethods: ["GET", "POST"],
      maxRequestsPerMinute: 2,
      stopConditions: {
        manualStop: false,
        maxRequestCount: null,
        repeatedServerErrors: false,
        authenticationLost: false,
        customNote: null,
      },
      notes: "Authorized test scope",
    };
    let first: ReturnType<typeof buildApp> | null = null;
    let second: ReturnType<typeof buildApp> | null = null;
    try {
      first = buildApp({ logger: false, dbPath });
      expect(
        (await first.inject({ method: "GET", url: "/scope" })).json(),
      ).toMatchObject({ scope: null, status: "NO_ACTIVE_SCOPE" });
      const missing = await first.inject({
        method: "POST",
        url: "/scope/preview",
        payload: { method: "GET", url: "https://example.test/api/users" },
      });
      expect(missing.json()).toMatchObject({
        requestSent: false,
        decision: { allowed: false, reasonCode: "NO_ACTIVE_SCOPE" },
      });
      expect(
        (
          await first.inject({
            method: "PUT",
            url: "/scope",
            payload: configuration,
          })
        ).statusCode,
      ).toBe(200);
      const allowed = await first.inject({
        method: "POST",
        url: "/scope/preview",
        payload: { method: "GET", url: "https://example.test/api/users" },
      });
      expect(allowed.json()).toMatchObject({
        requestSent: false,
        decision: { allowed: true, reasonCode: "IN_SCOPE" },
      });
      const denied = await first.inject({
        method: "POST",
        url: "/scope/preview",
        payload: { method: "GET", url: "https://other.test/api/users" },
      });
      expect(denied.json().decision).toMatchObject({
        allowed: false,
        reasonCode: "HOST_NOT_ALLOWED",
      });
      const redirect = await first.inject({
        method: "POST",
        url: "/scope/redirect-preview",
        payload: { method: "GET", redirectUrl: "https://other.test/" },
      });
      expect(redirect.json()).toMatchObject({
        redirectFollowed: false,
        decision: { allowed: false, reasonCode: "HOST_NOT_ALLOWED" },
      });
      expect(
        (
          await first.inject({
            method: "POST",
            url: "/scope/budget/consume",
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await first.inject({
            method: "POST",
            url: "/scope/budget/consume",
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await first.inject({
            method: "POST",
            url: "/scope/preview",
            payload: {
              method: "GET",
              url: "https://example.test/api/users",
            },
          })
        ).json().decision.reasonCode,
      ).toBe("RATE_LIMIT_EXHAUSTED");
      await first.inject({
        method: "PUT",
        url: "/scope",
        payload: {
          ...configuration,
          stopConditions: { ...configuration.stopConditions, manualStop: true },
        },
      });
      const stopped = await first.inject({
        method: "POST",
        url: "/scope/preview",
        payload: { method: "GET", url: "https://example.test/api/users" },
      });
      expect(stopped.json().decision.reasonCode).toBe("MANUAL_STOP_ACTIVE");
      const evidenceBefore = (
        await first.inject({ method: "GET", url: "/evidence" })
      ).json();
      expect(
        evidenceBefore.records.map(
          (item: { payload: { event?: string } }) => item.payload.event,
        ),
      ).toEqual(
        expect.arrayContaining(["scope_created", "manual_stop_activated"]),
      );
      await first.close();
      first = null;

      second = buildApp({ logger: false, dbPath });
      expect(
        (await second.inject({ method: "GET", url: "/scope" })).json(),
      ).toMatchObject({
        status: "ACTIVE_SCOPE",
        scope: {
          allowedHosts: ["example.test"],
          stopConditions: { manualStop: true, requestCount: 2 },
        },
      });
      expect(
        (await second.inject({ method: "GET", url: "/scope" })).json().scope
          .rateWindowTimestamps,
      ).toHaveLength(2);
      expect(
        (await second.inject({ method: "GET", url: "/evidence" })).json(),
      ).toEqual(evidenceBefore);
      await second.close();
      second = null;
    } finally {
      if (first) await first.close();
      if (second) await second.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }, 15000);

  test("persists a scope PUT without a later mutation", async () => {
    const directory = mkdtempSync(join(tmpdir(), "surfacetrace-scope-put-"));
    const dbPath = join(directory, "scope-put.db");
    let first: ReturnType<typeof buildApp> | null = null;
    let second: ReturnType<typeof buildApp> | null = null;
    try {
      first = buildApp({ logger: false, dbPath });
      const updated = await first.inject({
        method: "PUT",
        url: "/scope",
        payload: {
          active: true,
          allowedHosts: ["example.test"],
          allowedProtocols: ["https"],
          allowedPorts: [443],
          allowedPathPrefixes: ["/api/"],
          excludedPathPrefixes: [],
          allowedMethods: ["GET"],
          maxRequestsPerMinute: 1,
          stopConditions: {
            manualStop: false,
            maxRequestCount: null,
            repeatedServerErrors: false,
            authenticationLost: false,
            customNote: null,
          },
          notes: "Persist this update immediately",
        },
      });
      expect(updated.statusCode).toBe(200);
      await first.close();
      first = null;

      second = buildApp({ logger: false, dbPath });
      expect((await second.inject({ method: "GET", url: "/scope" })).json()).toMatchObject({
        status: "ACTIVE_SCOPE",
        scope: {
          allowedHosts: ["example.test"],
          notes: "Persist this update immediately",
        },
      });
    } finally {
      if (first) await first.close();
      if (second) await second.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("creates a versioned local database and default project", async () => {
    const directory = mkdtempSync(join(tmpdir(), "surfacetrace-schema-"));
    const dbPath = join(directory, "surfacetrace.db");
    let app: ReturnType<typeof buildApp> | null = null;
    try {
      app = buildApp({ logger: false, dbPath });
      expect(
        (await app.inject({ method: "GET", url: "/health" })).json(),
      ).toEqual({
        ok: true,
        service: "surfacetrace-server",
        version: "0.1.0",
      });
      const projects = (
        await app.inject({ method: "GET", url: "/projects" })
      ).json();
      expect(projects.projects).toEqual([
        expect.objectContaining({ name: "Untitled Investigation" }),
      ]);
      const created = await app.inject({
        method: "POST",
        url: "/projects",
        payload: { name: "Persistence Review" },
      });
      expect(created.statusCode).toBe(201);
      expect(created.json().name).toBe("Persistence Review");
      await app.close();
      app = null;
      expect(readFileSync(dbPath).subarray(0, 16).toString()).toBe(
        "SQLite format 3\u0000",
      );
    } finally {
      if (app) await app.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("fails clearly for an invalid database path", () => {
    const directory = mkdtempSync(join(tmpdir(), "surfacetrace-invalid-"));
    try {
      expect(() => buildApp({ logger: false, dbPath: directory })).toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("restores a complete investigation and exact evidence chain after restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "surfacetrace-restart-"));
    const dbPath = join(directory, "surfacetrace.db");
    let first: ReturnType<typeof buildApp> | null = null;
    let second: ReturnType<typeof buildApp> | null = null;
    try {
      first = buildApp({ logger: false, dbPath });
      const imported = await first.inject({
        method: "POST",
        url: "/import/har",
        payload: { har: sample, sourceLabel: "sample.har" },
      });
      expect(imported.statusCode).toBe(200);
      let inventory = (
        await first.inject({ method: "GET", url: "/inventory" })
      ).json();
      const endpoint = inventory.endpoints.find(
        (item: { pathTemplate: string }) =>
          item.pathTemplate === "/api/projects/{id}",
      );
      const observations = inventory.observations.filter(
        (item: { endpointId: string }) => item.endpointId === endpoint.id,
      );
      const input = inventory.inputs.find(
        (item: { endpointId: string; location: string }) =>
          item.endpointId === endpoint.id && item.location === "path",
      );
      const hypothesis = inventory.hypotheses.find(
        (item: { endpointId: string }) => item.endpointId === endpoint.id,
      );
      await first.inject({
        method: "PATCH",
        url: `/observations/${observations[0].id}/identity`,
        payload: { identityId: "account-a" },
      });
      const asset = (
        await first.inject({
          method: "POST",
          url: "/assets",
          payload: {
            label: "Project Data",
            category: "account_data",
            linkedEndpointIds: [endpoint.id],
            linkedObservationIds: [observations[0].id],
          },
        })
      ).json();
      const boundary = (
        await first.inject({
          method: "POST",
          url: "/trust-boundaries",
          payload: {
            label: "Application to Internal Service",
            type: "application_internal_service",
            sourceRef: "account-a",
            destinationRef: endpoint.id,
          },
        })
      ).json();
      const experiment = (
        await first.inject({
          method: "POST",
          url: "/experiments",
          payload: {
            endpointId: endpoint.id,
            hypothesisId: hypothesis.id,
            inputId: input.id,
            baselineObservationId: observations[0].id,
            resultObservationId: observations[1].id,
            mutation: {
              pathParam: { name: input.name, from: "100", to: "200" },
            },
          },
        })
      ).json().experiment;
      await first.inject({
        method: "PATCH",
        url: `/experiments/${experiment.id}`,
        payload: {
          conclusion: "needs_more_testing",
          notes: "Restart persistence review",
        },
      });
      inventory = (
        await first.inject({ method: "GET", url: "/inventory" })
      ).json();
      await first.inject({
        method: "PATCH",
        url: `/hypotheses/${hypothesis.id}`,
        payload: {
          status: "investigating",
          observationIds: [observations[0].id],
          experimentIds: [experiment.id],
          assetIds: [asset.id],
          trustBoundaryIds: [boundary.id],
          evidenceIds: [inventory.evidence[0].id],
          notes: "Persist linked context",
        },
      });
      const before = (
        await first.inject({ method: "GET", url: "/inventory" })
      ).json();
      const evidenceBefore = (
        await first.inject({ method: "GET", url: "/evidence" })
      ).json();
      const projects = (
        await first.inject({ method: "GET", url: "/projects" })
      ).json();
      const imports = (
        await first.inject({
          method: "GET",
          url: `/projects/${projects.activeProjectId}/imports`,
        })
      ).json();
      expect(imports.imports).toEqual([
        expect.objectContaining({ sourceLabel: "sample.har" }),
      ]);
      await first.close();
      first = null;

      second = buildApp({ logger: false, dbPath });
      const after = (
        await second.inject({ method: "GET", url: "/inventory" })
      ).json();
      const evidenceAfter = (
        await second.inject({ method: "GET", url: "/evidence" })
      ).json();
      expect(after.observations).toEqual(before.observations);
      expect(after.endpoints).toEqual(before.endpoints);
      expect(after.inputs).toEqual(before.inputs);
      expect(after.identities).toEqual(before.identities);
      expect(after.assets).toEqual(before.assets);
      expect(after.trustBoundaries).toEqual(before.trustBoundaries);
      expect(after.hypotheses).toEqual(before.hypotheses);
      expect(after.experiments).toEqual(before.experiments);
      expect(after.experiments[0].diff).toEqual(before.experiments[0].diff);
      expect(evidenceAfter).toEqual(evidenceBefore);
      expect(evidenceAfter.valid).toBe(true);
      expect(evidenceAfter.tip).toBe(evidenceBefore.tip);
      await second.close();
      second = null;

      const databaseText = readFileSync(dbPath).toString("utf8");
      for (const secret of [
        "secret-token-do-not-store",
        "fixture-cookie-secret-do-not-store",
        "should-be-redacted",
        "token=abc",
      ])
        expect(databaseText).not.toContain(secret);
    } finally {
      if (first) await first.close();
      if (second) await second.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("refuses persisted investigation entity tampering", async () => {
    const directory = mkdtempSync(join(tmpdir(), "surfacetrace-integrity-"));
    const dbPath = join(directory, "integrity.db");
    let app: ReturnType<typeof buildApp> | null = null;
    try {
      app = buildApp({ logger: false, dbPath });
      await app.inject({
        method: "POST",
        url: "/import/har",
        payload: { har: sample, sourceLabel: "historical integrity baseline" },
      });
      await app.inject({
        method: "POST",
        url: "/import/har",
        payload: { har: sample, sourceLabel: "active integrity baseline" },
      });
      expect(
        (await app.inject({ method: "GET", url: "/evidence" })).json(),
      ).toMatchObject({ valid: true, stateAnchored: true });
      await app.close();
      app = null;

      const database = new Database(dbPath);
      const row = database
        .prepare(
          `SELECT observations.id, observations.import_id AS importId, observations.payload
           FROM observations
           JOIN imports ON imports.id = observations.import_id
           WHERE imports.source_label = 'historical integrity baseline'
           LIMIT 1`,
        )
        .get() as { id: string; importId: string; payload: string };
      const payload = JSON.parse(row.payload) as {
        responseStatus: number;
        http: { response: { status: number } };
      };
      payload.responseStatus = 599;
      payload.http.response.status = 599;
      database
        .prepare(
          "UPDATE observations SET payload = ? WHERE id = ? AND import_id = ?",
        )
        .run(JSON.stringify(payload), row.id, row.importId);
      database.close();

      expect(() => buildApp({ logger: false, dbPath })).toThrow(
        "Persisted investigation integrity verification failed",
      );

      const withoutPolicy = new Database(dbPath);
      withoutPolicy.exec("DELETE FROM project_integrity_policy");
      withoutPolicy.close();
      expect(() => buildApp({ logger: false, dbPath })).toThrow(
        "Missing investigation integrity policy",
      );
    } finally {
      if (app) await app.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("never persists encoded or transport-level credential material", async () => {
    const directory = mkdtempSync(join(tmpdir(), "surfacetrace-redaction-"));
    const dbPath = join(directory, "redaction.db");
    const har = JSON.parse(sample) as {
      log: {
        entries: Array<{
          request: {
            method: string;
            url: string;
            headers: Array<{ name: string; value: string }>;
            postData?: { mimeType: string; encoding?: string; text: string };
          };
          response: {
            headers: Array<{ name: string; value: string }>;
            content: {
              size: number;
              mimeType: string;
              encoding?: string;
              text: string;
            };
          };
        }>;
      };
    };
    har.log.entries = [har.log.entries[0]!];
    const requestSecret = "encoded-request-credential";
    const responseSecret = "encoded-response-token";
    const encodedRequest = Buffer.from(
      JSON.stringify({ credential: requestSecret, action: "review" }),
    ).toString("base64");
    const encodedResponse = Buffer.from(
      JSON.stringify({ access_token: responseSecret, ok: true }),
    ).toString("base64");
    const entry = har.log.entries[0]!;
    entry.request.method = "POST";
    entry.request.url =
      "https://url-user:url-password@example.test/api/projects/100?code=oauth-code";
    entry.request.headers = [
      { name: "Content-Type", value: "application/json" },
      { name: "X-Amz-Security-Token", value: "aws-session-token" },
    ];
    entry.request.postData = {
      mimeType: "application/json",
      encoding: "base64",
      text: encodedRequest,
    };
    entry.response.headers = [
      {
        name: "Location",
        value: "https://example.test/callback?code=location-code",
      },
    ];
    entry.response.content = {
      size: encodedResponse.length,
      mimeType: "application/json",
      encoding: "base64",
      text: encodedResponse,
    };

    let app: ReturnType<typeof buildApp> | null = null;
    try {
      app = buildApp({ logger: false, dbPath });
      const imported = await app.inject({
        method: "POST",
        url: "/import/har",
        payload: { har: JSON.stringify(har) },
      });
      expect(imported.statusCode).toBe(200);
      const inventory = (
        await app.inject({ method: "GET", url: "/inventory" })
      ).body;
      for (const secret of [
        requestSecret,
        responseSecret,
        encodedRequest,
        encodedResponse,
        "url-user",
        "url-password",
        "oauth-code",
        "aws-session-token",
        "location-code",
      ])
        expect(inventory).not.toContain(secret);
      await app.close();
      app = null;

      const databaseText = readFileSync(dbPath).toString("utf8");
      for (const secret of [
        requestSecret,
        responseSecret,
        encodedRequest,
        encodedResponse,
        "url-user",
        "url-password",
        "oauth-code",
        "aws-session-token",
        "location-code",
      ])
        expect(databaseText).not.toContain(secret);
    } finally {
      if (app) await app.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("records inferred SSRF reasoning without destination values and preserves manual boundaries", async () => {
    const destination = "https://remote.example/private-image.png";
    const har = JSON.parse(sample) as {
      log: {
        entries: Array<{
          request: {
            method: string;
            url: string;
            headers: Array<{ name: string; value: string }>;
            postData?: { mimeType: string; text: string };
          };
        }>;
      };
    };
    har.log.entries = [har.log.entries[0]!];
    har.log.entries[0]!.request.method = "POST";
    har.log.entries[0]!.request.url = "https://example.test/api/image/import";
    har.log.entries[0]!.request.headers = [
      { name: "Content-Type", value: "application/json" },
    ];
    har.log.entries[0]!.request.postData = {
      mimeType: "application/json",
      text: JSON.stringify({ imageUrl: destination }),
    };
    const app = buildApp({ logger: false });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/import/har",
          payload: { har: JSON.stringify(har) },
        })
      ).statusCode,
    ).toBe(200);
    let inventory = (
      await app.inject({ method: "GET", url: "/inventory" })
    ).json();
    const hypothesis = inventory.hypotheses.find(
      (item: { reasoning?: { category?: string } }) =>
        item.reasoning?.category === "ssrf",
    );
    expect(hypothesis).toMatchObject({
      provenance: "inferred",
      reasoning: {
        inputName: "imageUrl",
        inputLocation: "body-json",
        valueClass: "absolute URL",
      },
    });
    const evidence = inventory.evidence.find((item: { id: string }) =>
      hypothesis.evidenceIds.includes(item.id),
    );
    expect(evidence.payload).toMatchObject({
      endpointId: hypothesis.endpointId,
      inputId: hypothesis.reasoning.inputId,
      signalType: "absolute_url",
      provenance: "inferred",
    });
    expect(JSON.stringify(evidence)).not.toContain(destination);

    const boundaryResponse = await app.inject({
      method: "POST",
      url: "/trust-boundaries",
      payload: {
        label: "Application to Third Party",
        type: "application_third_party",
        sourceRef: "account-a",
        destinationRef: hypothesis.endpointId,
      },
    });
    expect(boundaryResponse.statusCode).toBe(201);
    inventory = (await app.inject({ method: "GET", url: "/inventory" })).json();
    expect(inventory.trustBoundaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Application to Third Party",
          provenance: "manual",
        }),
      ]),
    );
    expect(inventory.graph.edges).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "boundary" })]),
    );
    await app.close();
  });

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

  test("persists structured human conclusions and enforces peer-review readiness", async () => {
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
      },
    });
    const experiment = created.json().experiment;
    const rejected = await app.inject({
      method: "PATCH",
      url: `/experiments/${experiment.id}`,
      payload: {
        structuredConclusion: {
          evidenceReadiness: "ready_for_peer_review",
          supportingEvidence: "",
        },
      },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error).toContain("evidence links");

    const updated = await app.inject({
      method: "PATCH",
      url: `/experiments/${experiment.id}`,
      payload: {
        structuredConclusion: {
          whatChanged: "path id changed from 100 to 200",
          whatRemainedConstant: "method, host, and route shape remained constant",
          expectedPolicy: "Object ownership should be enforced consistently",
          supportingEvidence: "experiment:" + experiment.id,
          unknowns: "Need a peer to verify account ownership context",
          reproduced: true,
          realUserDataEncountered: false,
          shouldStopTesting: true,
          evidenceReadiness: "ready_for_peer_review",
        },
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().experiment).toMatchObject({
      status: "closed",
      structuredConclusion: {
        whatChanged: "path id changed from 100 to 200",
        shouldStopTesting: true,
        evidenceReadiness: "ready_for_peer_review",
      },
    });
    const evidence = (await app.inject({ method: "GET", url: "/evidence" })).json();
    expect(JSON.stringify(evidence)).not.toContain("private");
    expect(
      evidence.records.slice(-2).map((item: { payload: { event: string } }) => item.payload.event),
    ).toEqual(expect.arrayContaining(["structured_conclusion_updated", "experiment_closed"]));
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

  test("persists manual threat annotations and hypothesis evidence links in the runtime graph", async () => {
    const app = buildApp({ logger: false });
    await app.inject({
      method: "POST",
      url: "/import/har",
      payload: { har: sample },
    });
    let inventory = (
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
    await app.inject({
      method: "PATCH",
      url: `/observations/${observations[0].id}/identity`,
      payload: { identityId: "account-a" },
    });
    const assetResponse = await app.inject({
      method: "POST",
      url: "/assets",
      payload: {
        label: "Project Owner Data",
        category: "pii",
        notes: "Tester annotation",
        linkedEndpointIds: [endpoint.id],
        linkedObservationIds: [observations[0].id],
      },
    });
    expect(assetResponse.statusCode).toBe(201);
    const asset = assetResponse.json();
    expect(asset).toMatchObject({ provenance: "manual", category: "pii" });
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/assets/${asset.id}`,
          payload: { label: "Project Account Data", category: "account_data" },
        })
      ).json(),
    ).toMatchObject({
      label: "Project Account Data",
      category: "account_data",
    });
    const boundaryResponse = await app.inject({
      method: "POST",
      url: "/trust-boundaries",
      payload: {
        label: "Browser to Project API",
        type: "browser_api",
        sourceRef: "account-a",
        destinationRef: endpoint.id,
        notes: "Manual boundary",
      },
    });
    expect(boundaryResponse.statusCode).toBe(201);
    const boundary = boundaryResponse.json();
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/trust-boundaries/${boundary.id}`,
          payload: { notes: "Reviewed boundary" },
        })
      ).json().notes,
    ).toBe("Reviewed boundary");
    const experimentResponse = await app.inject({
      method: "POST",
      url: "/experiments",
      payload: {
        endpointId: endpoint.id,
        hypothesisId: hypothesis.id,
        inputId: input.id,
        baselineObservationId: observations[0].id,
        resultObservationId: observations[1].id,
        mutation: { pathParam: { name: input.name, from: "100", to: "200" } },
      },
    });
    const experiment = experimentResponse.json().experiment;
    inventory = (await app.inject({ method: "GET", url: "/inventory" })).json();
    const evidenceId = inventory.evidence[0].id;
    const linked = await app.inject({
      method: "PATCH",
      url: `/hypotheses/${hypothesis.id}`,
      payload: {
        status: "supported",
        observationIds: [observations[0].id],
        experimentIds: [experiment.id],
        assetIds: [asset.id],
        trustBoundaryIds: [boundary.id],
        evidenceIds: [evidenceId],
        notes: "Evidence supports continuing review",
      },
    });
    expect(linked.json().hypothesis).toMatchObject({
      status: "supported",
      experimentIds: [experiment.id],
      assetIds: [asset.id],
      trustBoundaryIds: [boundary.id],
      provenance: "inferred",
    });
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/hypotheses/${hypothesis.id}`,
          payload: { status: "confirmed" },
        })
      ).statusCode,
    ).toBe(400);
    inventory = (await app.inject({ method: "GET", url: "/inventory" })).json();
    expect(
      inventory.graph.nodes.map(
        (item: { kind: string; provenance: string }) =>
          `${item.kind}:${item.provenance}`,
      ),
    ).toEqual(
      expect.arrayContaining([
        "endpoint:observed",
        "identity:manual",
        "asset:manual",
        "trust_boundary:manual",
        "hypothesis:inferred",
        "experiment:manual",
      ]),
    );
    expect(
      inventory.graph.edges.map(
        (item: { source: string; target: string }) =>
          `${item.source}->${item.target}`,
      ),
    ).toEqual(
      expect.arrayContaining([
        `account-a->${endpoint.id}`,
        `${endpoint.id}->${asset.id}`,
        `${hypothesis.id}->${endpoint.id}`,
        `${experiment.id}->${hypothesis.id}`,
      ]),
    );
    expect(
      (await app.inject({ method: "DELETE", url: `/assets/${asset.id}` }))
        .statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/trust-boundaries/${boundary.id}`,
        })
      ).statusCode,
    ).toBe(204);
    inventory = (await app.inject({ method: "GET", url: "/inventory" })).json();
    expect(inventory.assets).toEqual([]);
    expect(inventory.trustBoundaries).toEqual([]);
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
