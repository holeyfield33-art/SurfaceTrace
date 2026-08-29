import { readFileSync } from "node:fs";
import {
  EvidenceLedger,
  REDACTED,
  assertOneVariable,
  bodyShape,
  compareObservations,
  generateHypotheses,
  importHar,
  parseHarJson,
  redactHeaders,
  redactQueryParams,
  sanitizeUrl,
  redactBody,
  toPathTemplate,
} from "../src/index.js";
import type { Endpoint, InputDescriptor, Observation } from "../src/types.js";
import type { HarFile } from "../src/har/types.js";

describe("redaction", () => {
  test.each(["Authorization", "Cookie", "Set-Cookie", "X-API-Key"])(
    "redacts %s",
    (name) => {
      expect(redactHeaders({ [name]: "private" })[name]).toBe(REDACTED);
    },
  );
  test.each(["token", "access_token", "refresh_token", "password", "secret"])(
    "redacts %s",
    (name) => {
      expect(redactQueryParams({ [name]: "private" })[name]).toBe(REDACTED);
    },
  );
  test("keeps ordinary query values", () =>
    expect(redactQueryParams({ view: "full" }).view).toBe("full"));
  test("redacts nested JSON secret keys", () => {
    expect(bodyShape('{"profile":{"password":"private"}}')).toBe(
      '{"profile":{"password":"[REDACTED]"}}',
    );
  });
  test("sanitizes secret-bearing URLs", () => {
    expect(
      sanitizeUrl("https://example.test/account?access_token=abc123&view=full"),
    ).toBe(
      "https://example.test/account?access_token=%5BREDACTED%5D&view=full",
    );
  });
  test("sample HAR never normalizes the query secret", () => {
    const raw = readFileSync("../../fixtures/sample.har", "utf8");
    const result = importHar(parseHarJson(raw));
    expect(JSON.stringify(result)).not.toContain("token=abc");
    expect(JSON.stringify(result)).not.toContain('"value":"abc"');
    expect(JSON.stringify(result)).not.toContain(
      "fixture-cookie-secret-do-not-store",
    );
    expect(
      result.observations.find((item) => item.url.includes("admin"))?.url,
    ).toContain("%5BREDACTED%5D");
  });
  test("reconstructs one redacted HTTP transaction and parsed input model", () => {
    const har = fixture(
      "https://example.test/edit/10?view=full&token=query-secret",
    );
    const entry = har.log.entries[0]!;
    entry.request.method = "POST";
    entry.request.headers = [
      { name: "Content-Type", value: "application/x-www-form-urlencoded" },
    ];
    entry.request.cookies = [{ name: "session", value: "cookie-secret" }];
    entry.request.postData = {
      mimeType: "application/x-www-form-urlencoded",
      text: "title=test&password=body-secret",
    };
    entry.response.content = {
      size: 48,
      mimeType: "application/json",
      text: '{"title":"test","token":"response-secret"}',
    };
    const observation = importHar(har).observations[0]!;

    expect(observation.http.request).toMatchObject({
      target: "/edit/10?view=full&token=%5BREDACTED%5D",
      cookies: { session: REDACTED },
      body: "title=test&password=%5BREDACTED%5D",
    });
    expect(observation.http.request.headers).toMatchObject({
      Host: "example.test",
      Cookie: "session=[REDACTED]",
    });
    expect(observation.http.response.body).toContain(`"token": "${REDACTED}"`);
    expect(
      observation.parsedInputs.map(
        ({ location, name }) => `${location}.${name}`,
      ),
    ).toEqual(
      expect.arrayContaining([
        "path.id",
        "query.view",
        "query.token",
        "cookie.session",
        "body-form.title",
        "body-form.password",
      ]),
    );
    expect(JSON.stringify(observation)).not.toMatch(
      /query-secret|cookie-secret|body-secret|response-secret/,
    );
  });
  test("redacts secrets in JSON, forms, and plain assignment text", () => {
    expect(
      redactBody(
        '{"profile":{"password":"private"},"name":"Ada"}',
        "application/json",
      ),
    ).toContain('"password": "[REDACTED]"');
    expect(
      redactBody(
        "name=Ada&api_key=private",
        "application/x-www-form-urlencoded",
      ),
    ).toBe("name=Ada&api_key=%5BREDACTED%5D");
    expect(redactBody("token=private", "text/plain")).toBe("token=[REDACTED]");
  });
});

describe("route normalization", () => {
  test.each([
    ["/api/projects/100", "/api/projects/{id}"],
    ["/api/projects/200", "/api/projects/{id}"],
    ["/users/550e8400-e29b-41d4-a716-446655440000", "/users/{uuid}"],
    ["/assets/abcdef0123456789", "/assets/{hex}"],
    ["/normal/path", "/normal/path"],
    ["/", "/"],
  ])("normalizes %s", (path, expected) =>
    expect(toPathTemplate(path)).toBe(expected),
  );
  test("malformed URL entries are tolerated", () => {
    const har = fixture("not a URL");
    expect(importHar(har)).toMatchObject({
      observations: [],
      skippedEntries: 1,
    });
  });
});

describe("one-variable invariant", () => {
  const mutations = {
    pathParam: { pathParam: { name: "id", from: "1", to: "2" } },
    queryParam: { queryParam: { name: "q", from: "a", to: "b" } },
    header: {
      header: { name: "Origin", from: null, to: "https://example.test" },
    },
    bodyField: { bodyField: { path: "role", from: "user", to: "admin" } },
    identity: {
      identity: { fromRole: "user" as const, toRole: "admin" as const },
    },
  };
  test.each(Object.entries(mutations))("accepts %s alone", (kind, mutation) =>
    expect(assertOneVariable(mutation)).toBe(kind),
  );
  test("rejects zero variables", () =>
    expect(() => assertOneVariable({})).toThrow("none provided"));
  test.each([
    [mutations.pathParam, mutations.queryParam],
    [mutations.queryParam, mutations.bodyField],
    [mutations.bodyField, mutations.identity],
    [mutations.header, mutations.pathParam],
  ])("rejects combined variables", (a, b) =>
    expect(() => assertOneVariable({ ...a, ...b })).toThrow("exactly one"),
  );
});

describe("evidence ledger", () => {
  const ledger = () => {
    const value = new EvidenceLedger();
    value.append("note", { step: 1 });
    value.append("note", { step: 2 });
    return value;
  };
  test("valid chain", () => expect(ledger().verify()).toBe(true));
  test.each(["payload", "createdAt", "prevHash"])(
    "detects %s mutation",
    (field) => {
      const value = ledger();
      const record = value.all()[1]!;
      if (field === "payload") record.payload = { changed: true };
      if (field === "createdAt") record.createdAt = "2000-01-01T00:00:00.000Z";
      if (field === "prevHash") record.prevHash = "changed";
      expect(value.verify()).toBe(false);
    },
  );
  test("detects deletion", () => {
    const value = ledger();
    (value.all() as unknown[]).splice(0, 1);
    expect(value.verify()).toBe(false);
  });
  test("detects reordering", () => {
    const value = ledger();
    (value.all() as unknown[]).reverse();
    expect(value.verify()).toBe(false);
  });
});

describe("observation comparison", () => {
  const observation = (overrides: Partial<Observation> = {}): Observation => ({
    id: "obs",
    endpointId: "ep",
    method: "GET",
    url: "https://example.test/items/1",
    pathTemplate: "/items/{id}",
    requestHeaders: {},
    requestBodyShape: null,
    responseStatus: 200,
    responseHeaders: { "Content-Type": "application/json" },
    responseBodyShape: '{"id":"number"}',
    responseSize: 20,
    capturedAt: "now",
    redacted: true,
    contentHash: "hash",
    http: {
      request: {
        httpVersion: "HTTP/1.1",
        target: "/items/1",
        headers: {},
        cookies: {},
        query: {},
        body: null,
      },
      response: {
        httpVersion: "HTTP/1.1",
        status: 200,
        statusText: "OK",
        headers: {},
        body: null,
      },
    },
    parsedInputs: [],
    identityId: null,
    ...overrides,
  });
  test("reports no material difference for equivalent observations", () => {
    expect(
      compareObservations("exp", observation(), observation({ id: "result" }))
        .summary,
    ).toBe("No material difference observed");
  });
  test("reports status and size changes", () => {
    const diff = compareObservations(
      "exp",
      observation(),
      observation({ responseStatus: 403, responseSize: 35 }),
    );
    expect(diff).toMatchObject({
      statusChanged: true,
      statusFrom: 200,
      statusTo: 403,
      lengthDelta: 15,
    });
  });
  test("reports response shape changes", () => {
    const diff = compareObservations(
      "exp",
      observation(),
      observation({ responseBodyShape: '{"id":"number","owner":"string"}' }),
    );
    expect(diff.jsonKeysAdded).toEqual(["owner"]);
  });
  const withBody = (
    body: unknown,
    overrides: Partial<Observation> = {},
  ): Observation =>
    observation({
      responseBodyShape: JSON.stringify(body),
      http: {
        request: {
          httpVersion: "HTTP/1.1",
          target: "/items/1",
          headers: {},
          cookies: {},
          query: {},
          body: null,
        },
        response: {
          httpVersion: "HTTP/1.1",
          status: 200,
          statusText: "OK",
          headers: {},
          body: JSON.stringify(body),
        },
      },
      ...overrides,
    });
  test("reports deterministic nested fields, values, types, null changes, and ordering", () => {
    const before = withBody({
      z: true,
      user: { email: null, profile: { phone: "1" }, role: "user", removed: 1 },
      balance: 10,
    });
    const after = withBody({
      a: false,
      user: {
        email: "other@example.test",
        profile: { phone: 2 },
        role: "admin",
      },
      balance: "10",
    });
    const diff = compareObservations("deep", before, after);
    expect(diff.bodyChanges).toEqual([
      { path: "a", changeType: "added", before: null, after: false },
      { path: "balance", changeType: "type_changed", before: 10, after: "10" },
      {
        path: "user.email",
        changeType: "type_changed",
        before: null,
        after: "other@example.test",
      },
      {
        path: "user.profile.phone",
        changeType: "type_changed",
        before: "1",
        after: 2,
      },
      { path: "user.removed", changeType: "removed", before: 1, after: null },
      {
        path: "user.role",
        changeType: "value_changed",
        before: "user",
        after: "admin",
      },
      { path: "z", changeType: "removed", before: true, after: null },
    ]);
    expect(compareObservations("deep", before, after).bodyChanges).toEqual(
      diff.bodyChanges,
    );
  });
  test("compares nested arrays by index and reports length", () => {
    const diff = compareObservations(
      "arrays",
      withBody({
        orders: [{ status: "open" }],
        roles: ["user"],
        obsolete: [1, 2],
      }),
      withBody({
        orders: [{ status: "closed" }, { status: "new" }],
        roles: [7],
        obsolete: [1],
      }),
    );
    expect(diff.bodyChanges).toEqual(
      expect.arrayContaining([
        {
          path: "orders.length",
          changeType: "array_length_changed",
          before: 1,
          after: 2,
        },
        {
          path: "orders[0].status",
          changeType: "value_changed",
          before: "open",
          after: "closed",
        },
        {
          path: "orders[1]",
          changeType: "added",
          before: null,
          after: { status: "new" },
        },
        { path: "obsolete[1]", changeType: "removed", before: 2, after: null },
        {
          path: "roles[0]",
          changeType: "type_changed",
          before: "user",
          after: 7,
        },
      ]),
    );
  });
  test("reports identical and malformed JSON explicitly", () => {
    expect(
      compareObservations(
        "same",
        withBody({ nested: { value: 1 } }),
        withBody({ nested: { value: 1 } }),
      ),
    ).toMatchObject({ bodyComparison: "identical", bodyChanges: [] });
    const malformed = withBody(
      {},
      {
        http: {
          request: {
            httpVersion: "HTTP/1.1",
            target: "/",
            headers: {},
            cookies: {},
            query: {},
            body: null,
          },
          response: {
            httpVersion: "HTTP/1.1",
            status: 200,
            statusText: "OK",
            headers: {},
            body: "not-json",
          },
        },
      },
    );
    expect(compareObservations("bad", malformed, withBody({}))).toMatchObject({
      bodyComparison: "non_json",
      bodyChanges: [],
    });
  });
  test.each([
    [{ maxDiffRecords: 1 }, "max_diff_records"],
    [{ maxDepth: 1 }, "max_depth"],
    [{ maxNodes: 1 }, "max_nodes"],
  ])("reports truncation for %o", (limits, reason) => {
    const diff = compareObservations(
      "limited",
      withBody({ a: { b: 1 }, c: 1 }),
      withBody({ a: { b: 2 }, c: 2 }),
      limits,
    );
    expect(diff).toMatchObject({ truncated: true, truncationReason: reason });
  });
  test("redacts nested secrets before recording before and after values", () => {
    const diff = compareObservations(
      "secret",
      withBody({ profile: {}, token: "old-secret" }),
      withBody({ profile: { password: "after-secret" }, token: "new-secret" }),
    );
    expect(JSON.stringify(diff)).not.toMatch(
      /before-secret|after-secret|old-secret|new-secret/,
    );
    expect(diff.bodyChanges).toEqual([
      {
        path: "profile.password",
        changeType: "added",
        before: null,
        after: REDACTED,
      },
    ]);
  });
});

describe("hypothesis engine", () => {
  const endpoint = (overrides: Partial<Endpoint> = {}): Endpoint => ({
    id: "ep",
    method: "GET",
    host: "example.test",
    pathTemplate: "/public",
    firstSeen: "now",
    lastSeen: "now",
    statusCodes: [200],
    requiresAuth: null,
    observationCount: 1,
    ...overrides,
  });
  const input = (
    overrides: Partial<InputDescriptor> = {},
  ): InputDescriptor => ({
    id: "in",
    endpointId: "ep",
    name: "q",
    location: "query",
    sampleTypes: ["string"],
    sensitivity: "normal",
    observedCount: 1,
    appearsRequired: null,
    ...overrides,
  });
  test.each([
    [endpoint(), [input({ name: "id" })], "object-id-in-path-or-input"],
    [endpoint({ method: "POST" }), [], "state-changing-method"],
    [endpoint({ pathTemplate: "/admin" }), [], "admin-or-internal-route"],
    [endpoint(), [input({ name: "callback" })], "user-controlled-redirect"],
    [endpoint({ pathTemplate: "/upload" }), [], "file-handling"],
    [endpoint({ statusCodes: [500] }), [], "server-error-observed"],
  ])("positive deterministic rule %#", (ep, inputs, signal) =>
    expect(
      generateHypotheses([ep as Endpoint], inputs as InputDescriptor[]).some(
        (h) => h.signal === signal,
      ),
    ).toBe(true),
  );
  test("negative fixture triggers no rules", () =>
    expect(generateHypotheses([endpoint()], [input()])).toEqual([]));
});

describe("unified request inputs", () => {
  test("extracts descriptors without raw secrets", () => {
    const har = fixture(
      "https://example.test/api/projects/123?view=full&token=query-secret",
    );
    har.log.entries[0]!.request.headers = [
      { name: "Content-Type", value: "application/json" },
      { name: "Authorization", value: "Bearer header-secret" },
    ];
    har.log.entries[0]!.request.cookies = [
      { name: "session", value: "cookie-secret" },
    ];
    har.log.entries[0]!.request.postData = {
      mimeType: "application/json",
      text: '{"title":"Hello","profile":{"password":"body-secret"}}',
    };
    const result = importHar(har);
    expect(
      result.inputs.map(({ location, name }) => `${location}:${name}`),
    ).toEqual(
      expect.arrayContaining([
        "path:id",
        "query:view",
        "query:token",
        "header:Content-Type",
        "header:Authorization",
        "cookie:session",
        "body-json:title",
        "body-json:profile.password",
      ]),
    );
    const serialized = JSON.stringify(result);
    for (const secret of [
      "query-secret",
      "header-secret",
      "cookie-secret",
      "body-secret",
    ])
      expect(serialized).not.toContain(secret);
  });
  test.each([
    [
      {
        mimeType: "application/x-www-form-urlencoded",
        text: "email=person%40example.test&password=form-secret",
      },
      ["email", "password"],
    ],
    [
      {
        mimeType: "multipart/form-data; boundary=test",
        params: [{ name: "avatar", value: "file-secret" }],
      },
      ["avatar"],
    ],
  ])("extracts form field names without values", (postData, names) => {
    const har = fixture("https://example.test/profile");
    har.log.entries[0]!.request.postData = postData;
    const result = importHar(har);
    expect(
      result.inputs
        .filter((item) => item.location === "body-form")
        .map((item) => item.name),
    ).toEqual(names);
    expect(JSON.stringify(result)).not.toMatch(/form-secret|file-secret/);
  });
});

function fixture(url: string): HarFile {
  return {
    log: {
      version: "1.2",
      creator: { name: "test", version: "1" },
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
            headers: [],
            content: { size: 0, mimeType: "text/plain" },
          },
        },
      ],
    },
  };
}
