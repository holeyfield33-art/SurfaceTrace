import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IdentityContext, Observation } from "@surfacetrace/core";
import { buildApp } from "../src/app.js";
import { executeReplayRequest } from "../src/replay/httpClient.js";
import { reconstructRequest } from "../src/replay/reconstruct.js";
import { validateRuntimeCredentialHeaders } from "../src/replay/credentialHeaders.js";

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
    expect(result.preview).toMatchObject({
      method: "POST",
      url: expect.stringContaining("/items/100"),
      headers: {
        Authorization: "[REDACTED]",
        Cookie: "[REDACTED]",
      },
    });
    expect(JSON.stringify(result.preview)).not.toContain("runtime-only-secret");
    expect(JSON.stringify(result.preview)).not.toContain("runtime-cookie");
  });

  test("enforces one canonical runtime credential header policy", () => {
    const rejected = [
      "Host", "hOsT", "Content-Length", "Transfer-Encoding", "Connection",
      "Upgrade", "Keep-Alive", "Trailer", "TE", "Proxy-Authorization",
      "Proxy-Authenticate", "Forwarded", "X-Forwarded-For",
      "X-Forwarded-Host", "X-Forwarded-Proto", "X-Forwarded-Port", "Via",
      ":authority", "bad header", "bad\rname",
    ];
    for (const name of rejected)
      expect(() =>
        validateRuntimeCredentialHeaders({ [name]: "safe" }, [name]),
      ).toThrow(/rejected/i);
    expect(() =>
      validateRuntimeCredentialHeaders({ Authorization: "bad\r\nvalue" }),
    ).toThrow(/Authorization/);
    expect(() =>
      validateRuntimeCredentialHeaders({
        Authorization: "Bearer one",
        authorization: "Bearer two",
      }),
    ).toThrow(/Duplicate/);
    expect(
      validateRuntimeCredentialHeaders({ Authorization: "Bearer safe" }),
    ).toEqual({ Authorization: "Bearer safe" });
    expect(
      validateRuntimeCredentialHeaders(
        { "X-Review-Key": "runtime-secret" },
        ["X-Review-Key"],
      ),
    ).toEqual({ "X-Review-Key": "runtime-secret" });
  });

  test("rejects credential overrides of protected reconstructed headers", () => {
    expect(() =>
      reconstructRequest(
        observation({ identityId: "account-a" }),
        { identity: { fromRole: "user", toRole: "admin" } },
        identities,
        new Map([
          [
            "privileged",
            {
              headers: { "Content-Type": "credential-value" },
              cookies: {},
              approvedApiKeyHeaderNames: ["Content-Type"],
            },
          ],
        ]),
        "privileged",
      ),
    ).toThrow(/cannot override request header/i);
  });
});

describe("dedicated replay HTTP client", () => {
  let server: Server;
  let baseUrl: string;
  let requests = 0;

  beforeAll(async () => {
    server = createServer((request, response) => {
      requests += 1;
      if (request.url?.startsWith("/server-error/")) {
        response.writeHead(500, { "Content-Type": "application/json" });
        response.end('{"error":"controlled server error"}');
        return;
      }
      if (request.url?.startsWith("/unauthorized/")) {
        response.writeHead(401, { "Content-Type": "application/json" });
        response.end('{"error":"controlled authentication loss"}');
        return;
      }
      if (request.url === "/redirect") {
        response.writeHead(302, { Location: "/final" }).end();
        return;
      }
      if (request.url?.startsWith("/slow")) {
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
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
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

  test("revalidates dangerous headers before any network execution", async () => {
    const before = requests;
    await expect(
      executeReplayRequest({
        method: "GET",
        url: `${baseUrl}/safe`,
        headers: { Host: "other.test" },
        body: null,
      }),
    ).rejects.toThrow(/Host/);
    expect(requests).toBe(before);
  });

  test("rejects unsafe credentials at registration without returning values", async () => {
    const app = buildApp({ logger: false });
    try {
      const unsafe = await app.inject({
        method: "PUT",
        url: "/replay/credentials/privileged",
        payload: { headers: { "X-Forwarded-Host": "secret.test" }, cookies: {} },
      });
      expect(unsafe.statusCode).toBe(400);
      expect(unsafe.body).not.toContain("secret.test");
      const safe = await app.inject({
        method: "PUT",
        url: "/replay/credentials/privileged",
        payload: {
          headers: { "X-Review-Key": "runtime-only-secret" },
          cookies: {},
          approvedApiKeyHeaderNames: ["X-Review-Key"],
        },
      });
      expect(safe.statusCode).toBe(200);
      expect(safe.body).not.toContain("runtime-only-secret");
      expect(safe.json()).toMatchObject({
        persisted: false,
        headerNames: ["X-Review-Key"],
      });
    } finally {
      await app.close();
    }
  }, 15_000);

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
        baseline: {
          method: "GET",
          url: expect.stringContaining("/items/100?view=full"),
          headers: expect.any(Object),
          body: null,
        },
        preview: {
          method: "GET",
          url: expect.stringContaining("/items/101?view=full"),
          headers: expect.any(Object),
          body: null,
        },
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

  test("isolates runtime replay state across project transitions", async () => {
    const app = buildApp({ logger: false });
    try {
      const port = Number(new URL(baseUrl).port);
      await app.inject({
        method: "POST",
        url: "/import/har",
        payload: { har: replayHar(`${baseUrl}/items/100?view=full`) },
      });
      const projectA = (
        await app.inject({ method: "GET", url: "/projects" })
      ).json().activeProjectId;
      const baselineA = (
        await app.inject({ method: "GET", url: "/inventory" })
      ).json().observations[0];
      await app.inject({
        method: "PATCH",
        url: `/observations/${baselineA.id}/identity`,
        payload: { identityId: "account-a" },
      });
      await app.inject({
        method: "PUT",
        url: "/scope",
        payload: { ...scopeConfig(port), maxRequestsPerMinute: 1 },
      });
      await app.inject({
        method: "PUT",
        url: "/replay/credentials/privileged",
        payload: {
          headers: { "X-Review-Key": "project-a-runtime-secret" },
          cookies: {},
          approvedApiKeyHeaderNames: ["X-Review-Key"],
        },
      });
      const preparedA = await app.inject({
        method: "POST",
        url: "/replay/prepare",
        payload: {
          baselineObservationId: baselineA.id,
          mutation: { identity: { fromRole: "user", toRole: "admin" } },
          targetIdentityId: "privileged",
        },
      });
      expect(preparedA.statusCode).toBe(200);
      expect(preparedA.json().token).toBeTruthy();
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/scope/budget/consume",
          })
        ).statusCode,
      ).toBe(200);

      const projectB = (
        await app.inject({
          method: "POST",
          url: "/projects",
          payload: { name: "Project B" },
        })
      ).json();
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/projects/${projectB.id}/open`,
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (await app.inject({ method: "GET", url: "/graph" })).statusCode,
      ).toBe(404);
      expect((await app.inject({ method: "GET", url: "/scope" })).json()).toMatchObject({
        scope: null,
        status: "NO_ACTIVE_SCOPE",
      });

      const before = requests;
      const staleToken = await app.inject({
        method: "POST",
        url: `/replay/${preparedA.json().token}/send`,
        payload: { approval: true },
      });
      expect(staleToken.statusCode).toBe(404);
      expect(requests).toBe(before);

      await app.inject({
        method: "PUT",
        url: "/scope",
        payload: { ...scopeConfig(port), maxRequestsPerMinute: 1 },
      });
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/scope/preview",
            payload: { method: "GET", url: `${baseUrl}/items/101` },
          })
        ).json().decision.reasonCode,
      ).toBe("IN_SCOPE");
      await app.inject({
        method: "POST",
        url: "/import/har",
        payload: { har: replayHar(`${baseUrl}/items/100?view=full`) },
      });
      const baselineB = (
        await app.inject({ method: "GET", url: "/inventory" })
      ).json().observations[0];
      await app.inject({
        method: "PATCH",
        url: `/observations/${baselineB.id}/identity`,
        payload: { identityId: "account-a" },
      });
      const missingCredential = await app.inject({
        method: "POST",
        url: "/replay/prepare",
        payload: {
          baselineObservationId: baselineB.id,
          mutation: { identity: { fromRole: "user", toRole: "admin" } },
          targetIdentityId: "privileged",
        },
      });
      expect(missingCredential.statusCode).toBe(400);
      expect(missingCredential.body).toContain("credentials are unavailable");
      expect(missingCredential.body).not.toContain("project-a-runtime-secret");
      expect(requests).toBe(before);

      expect(
        (
          await app.inject({
            method: "POST",
            url: `/projects/${projectA}/open`,
          })
        ).statusCode,
      ).toBe(200);
      expect((await app.inject({ method: "GET", url: "/graph" })).statusCode).toBe(200);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/scope/preview",
            payload: { method: "GET", url: `${baseUrl}/items/101` },
          })
        ).json().decision.reasonCode,
      ).toBe("RATE_LIMIT_EXHAUSTED");
    } finally {
      await app.close();
    }
  });

  test("blocks project transitions while an approved replay is in flight", async () => {
    const app = buildApp({ logger: false, replayTimeoutMs: 1_000 });
    try {
      const port = Number(new URL(baseUrl).port);
      await app.inject({
        method: "POST",
        url: "/import/har",
        payload: { har: replayHar(`${baseUrl}/slow/100`) },
      });
      const baseline = (
        await app.inject({ method: "GET", url: "/inventory" })
      ).json().observations[0];
      await app.inject({
        method: "PUT",
        url: "/scope",
        payload: {
          ...scopeConfig(port),
          allowedPathPrefixes: ["/slow/"],
        },
      });
      const prepared = await app.inject({
        method: "POST",
        url: "/replay/prepare",
        payload: {
          baselineObservationId: baseline.id,
          mutation: { pathParam: { name: "id", from: "100", to: "101" } },
        },
      });
      const projectB = (
        await app.inject({
          method: "POST",
          url: "/projects",
          payload: { name: "Concurrent Project B" },
        })
      ).json();
      const before = requests;
      const sending = app.inject({
        method: "POST",
        url: `/replay/${prepared.json().token}/send`,
        payload: { approval: true },
      });
      for (let attempt = 0; attempt < 30 && requests === before; attempt += 1)
        await new Promise((resolve) => {
          setTimeout(resolve, 10);
        });
      expect(requests).toBe(before + 1);

      const blocked = await app.inject({
        method: "POST",
        url: `/projects/${projectB.id}/open`,
      });
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().error).toContain("replay is in flight");
      const sent = await sending;
      expect(sent.statusCode).toBe(200);
      expect(sent.json().response.status).toBe(200);

      expect(
        (
          await app.inject({
            method: "POST",
            url: `/projects/${projectB.id}/open`,
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (await app.inject({ method: "GET", url: "/inventory" })).statusCode,
      ).toBe(404);
    } finally {
      await app.close();
    }
  });

  test("latches, persists, and explicitly resets automatic replay stops", async () => {
    const directory = mkdtempSync(join(tmpdir(), "surfacetrace-stops-"));
    const dbPath = join(directory, "stops.db");
    let first: ReturnType<typeof buildApp> | null = null;
    let second: ReturnType<typeof buildApp> | null = null;
    let third: ReturnType<typeof buildApp> | null = null;
    try {
      const port = Number(new URL(baseUrl).port);
      const errorScope = {
        ...scopeConfig(port),
        allowedPathPrefixes: ["/server-error/"],
        maxRequestsPerMinute: 10,
      };
      first = buildApp({ logger: false, dbPath });
      await first.inject({
        method: "POST",
        url: "/import/har",
        payload: { har: replayHar(`${baseUrl}/server-error/100`) },
      });
      const baseline = (
        await first.inject({ method: "GET", url: "/inventory" })
      ).json().observations[0];
      await first.inject({ method: "PUT", url: "/scope", payload: errorScope });

      for (const target of ["101", "102", "103"]) {
        const prepared = await first.inject({
          method: "POST",
          url: "/replay/prepare",
          payload: {
            baselineObservationId: baseline.id,
            mutation: { pathParam: { name: "id", from: "100", to: target } },
          },
        });
        expect(prepared.json().token).toBeTruthy();
        const sent = await first.inject({
          method: "POST",
          url: `/replay/${prepared.json().token}/send`,
          payload: { approval: true },
        });
        expect(sent.statusCode).toBe(200);
        expect(sent.json().response.status).toBe(500);
      }
      expect((await first.inject({ method: "GET", url: "/scope" })).json()).toMatchObject({
        scope: {
          stopConditions: {
            repeatedServerErrors: true,
            serverErrorCount: 3,
          },
        },
      });
      const ordinaryUpdate = await first.inject({
        method: "PUT",
        url: "/scope",
        payload: errorScope,
      });
      expect(
        ordinaryUpdate.json().scope.stopConditions.repeatedServerErrors,
      ).toBe(true);
      expect(
        (
          await first.inject({
            method: "POST",
            url: "/scope/preview",
            payload: { method: "GET", url: `${baseUrl}/server-error/104` },
          })
        ).json().decision.reasonCode,
      ).toBe("REPEATED_SERVER_ERRORS");
      await first.close();
      first = null;

      second = buildApp({ logger: false, dbPath });
      expect((await second.inject({ method: "GET", url: "/scope" })).json()).toMatchObject({
        scope: { stopConditions: { repeatedServerErrors: true } },
      });
      const resetErrors = await second.inject({
        method: "POST",
        url: "/scope/stops/reset",
        payload: { condition: "repeatedServerErrors" },
      });
      expect(resetErrors.json()).toMatchObject({
        reset: true,
        wasActive: true,
        scope: {
          stopConditions: {
            repeatedServerErrors: false,
            serverErrorCount: 0,
          },
        },
      });

      await second.inject({
        method: "POST",
        url: "/import/har",
        payload: { har: replayHar(`${baseUrl}/unauthorized/100`) },
      });
      const unauthorizedBaseline = (
        await second.inject({ method: "GET", url: "/inventory" })
      ).json().observations[0];
      await second.inject({
        method: "PUT",
        url: "/scope",
        payload: {
          ...scopeConfig(port),
          allowedPathPrefixes: ["/unauthorized/"],
          maxRequestsPerMinute: 10,
        },
      });
      const unauthorizedPreview = await second.inject({
        method: "POST",
        url: "/replay/prepare",
        payload: {
          baselineObservationId: unauthorizedBaseline.id,
          mutation: { pathParam: { name: "id", from: "100", to: "101" } },
        },
      });
      const unauthorized = await second.inject({
        method: "POST",
        url: `/replay/${unauthorizedPreview.json().token}/send`,
        payload: { approval: true },
      });
      expect(unauthorized.json().response.status).toBe(401);
      expect((await second.inject({ method: "GET", url: "/scope" })).json()).toMatchObject({
        scope: { stopConditions: { authenticationLost: true } },
      });
      const cannotSilentlyClear = await second.inject({
        method: "PUT",
        url: "/scope",
        payload: {
          ...scopeConfig(port),
          allowedPathPrefixes: ["/unauthorized/"],
          maxRequestsPerMinute: 10,
        },
      });
      expect(
        cannotSilentlyClear.json().scope.stopConditions.authenticationLost,
      ).toBe(true);
      await second.close();
      second = null;

      third = buildApp({ logger: false, dbPath });
      expect((await third.inject({ method: "GET", url: "/scope" })).json()).toMatchObject({
        scope: { stopConditions: { authenticationLost: true } },
      });
      const resetAuthentication = await third.inject({
        method: "POST",
        url: "/scope/stops/reset",
        payload: { condition: "authenticationLost" },
      });
      expect(resetAuthentication.json()).toMatchObject({
        reset: true,
        wasActive: true,
        scope: { stopConditions: { authenticationLost: false } },
      });
      const evidence = (
        await third.inject({ method: "GET", url: "/evidence" })
      ).json().records;
      expect(
        evidence.filter(
          (record: { payload: { event?: string } }) =>
            record.payload.event === "scope_stop_activated",
        ),
      ).toHaveLength(2);
      expect(
        evidence.filter(
          (record: { payload: { event?: string } }) =>
            record.payload.event === "scope_stop_reset",
        ),
      ).toHaveLength(2);
    } finally {
      if (first) await first.close();
      if (second) await second.close();
      if (third) await third.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }, 20_000);
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
