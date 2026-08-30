import { readFileSync } from "node:fs";
import {
  EvidenceLedger,
  REDACTED,
  assertOneVariable,
  bodyShape,
  buildEvidenceCoverage,
  buildGraph,
  compareObservations,
  generateHypotheses,
  isRequestInScope,
  evaluateRedirectTarget,
  RequestBudget,
  importHar,
  parseHarJson,
  redactHeaders,
  redactQueryParams,
  sanitizeUrl,
  redactBody,
  toPathTemplate,
} from "../src/index.js";
import type {
  Asset,
  Endpoint,
  Experiment,
  IdentityContext,
  InputDescriptor,
  Observation,
  TrustBoundary,
  ProjectScope,
} from "../src/types.js";
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

describe("evidence coverage", () => {
  test("reports passive evidence gaps deterministically", () => {
    const report = buildEvidenceCoverage({
      observations: [
        {
          id: "obs-1",
          endpointId: "ep-1",
          method: "GET",
          url: "https://example.test/api/projects/100",
          pathTemplate: "/api/projects/{id}",
          requestHeaders: { Authorization: "[REDACTED]" },
          requestBodyShape: null,
          responseStatus: 302,
          responseHeaders: { Location: "https://example.test/login" },
          responseBodyShape: null,
          responseSize: 0,
          capturedAt: "2026-08-30T10:00:00.000Z",
          redacted: true,
          contentHash: "hash-1",
          http: {
            request: {
              httpVersion: "HTTP/1.1",
              target: "/api/projects/100",
              headers: { Authorization: "[REDACTED]" },
              cookies: {},
              query: {},
              body: null,
            },
            response: {
              httpVersion: "HTTP/1.1",
              status: 302,
              statusText: "Found",
              headers: { Location: "/login" },
              body: null,
            },
          },
          parsedInputs: [],
          identityId: null,
        },
      ],
      inputs: [],
      hypotheses: [
        {
          id: "hyp-1",
          endpointId: "ep-1",
          question: "Review object access policy",
          signal: "object-id-in-path-or-input",
          strideCategory: null,
          priority: 5,
          status: "open",
          observationIds: [],
          experimentIds: [],
          assetIds: [],
          trustBoundaryIds: [],
          evidenceIds: [],
          notes: null,
          provenance: "inferred",
        },
      ],
    });
    expect(report).toMatchObject({
      importedObservationCount: 1,
      endpointCount: 1,
      hostCount: 1,
      methodsRepresented: ["GET"],
      identityContextsRepresented: ["Unassigned"],
      disclaimer:
        "Imported coverage is not proof of complete application coverage.",
    });
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Observed only once" }),
        expect.objectContaining({ title: "Potential evidence gap" }),
        expect.objectContaining({ title: "No comparison observation" }),
      ]),
    );
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

  test.each([
    "url",
    "callbackUrl",
    "callback_url",
    "callback-url",
    "webhook_url",
    "hostname",
    "avatarURL",
  ])("creates an SSRF review signal for semantic input %s", (name) => {
    const hypotheses = generateHypotheses([endpoint()], [input({ name })]);
    expect(
      hypotheses.find((item) => item.reasoning?.category === "ssrf"),
    ).toMatchObject({
      provenance: "inferred",
      reasoning: {
        inputName: name,
        signalType: "input_name",
        signalStrength: "moderate",
      },
    });
  });

  test.each([
    "username",
    "userId",
    "sourceCode",
    "hostedPlan",
    "targetCount",
    "imageWidth",
    "linkColor",
    "domainKnowledge",
  ])("does not create an SSRF review signal for %s", (name) => {
    expect(
      generateHypotheses([endpoint()], [input({ name })]).some(
        (item) => item.reasoning?.category === "ssrf",
      ),
    ).toBe(false);
  });

  test.each([
    ["query", undefined],
    ["body-json", "application/json"],
    ["body-form", "application/x-www-form-urlencoded"],
  ])("detects an absolute URL in %s without retaining it", (location, mime) => {
    const secretDestination = "https://destination.example/private";
    const har = fixture(
      location === "query"
        ? `https://example.test/public?q=${encodeURIComponent(secretDestination)}`
        : "https://example.test/public",
    );
    if (location === "body-json") {
      har.log.entries[0]!.request.method = "POST";
      har.log.entries[0]!.request.postData = {
        mimeType: mime!,
        text: JSON.stringify({ q: secretDestination }),
      };
    }
    if (location === "body-form") {
      har.log.entries[0]!.request.method = "POST";
      har.log.entries[0]!.request.postData = {
        mimeType: mime!,
        text: `q=${encodeURIComponent(secretDestination)}`,
      };
    }
    const imported = importHar(har);
    const hypothesis = generateHypotheses(
      imported.endpoints,
      imported.inputs,
      imported.observations,
    ).find((item) => item.reasoning?.category === "ssrf");
    expect(hypothesis?.reasoning).toMatchObject({
      signalType: "absolute_url",
      valueClass: "absolute URL",
      signalStrength: "strong",
    });
    expect(JSON.stringify(hypothesis)).not.toContain(secretDestination);
  });

  test("keeps redirect and server-fetch questions separate", () => {
    const hypotheses = generateHypotheses(
      [endpoint()],
      [input({ name: "next" })],
    );
    expect(
      hypotheses.some((item) => item.reasoning?.category === "redirect"),
    ).toBe(true);
    expect(hypotheses.some((item) => item.reasoning?.category === "ssrf")).toBe(
      true,
    );
    expect(new Set(hypotheses.map((item) => item.question)).size).toBe(
      hypotheses.length,
    );
  });

  test("creates both questions for an ambiguous destination callback", () => {
    const hypotheses = generateHypotheses(
      [endpoint()],
      [input({ name: "callbackUrl" })],
    );
    expect(
      hypotheses.map((item) => item.reasoning?.category).filter(Boolean),
    ).toEqual(expect.arrayContaining(["ssrf", "redirect"]));
  });
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

describe("threat map relationships", () => {
  test("generates observed, manual, and inferred nodes with investigation edges", () => {
    const imported = importHar(fixture("https://example.test/orders/100"));
    const observation = imported.observations[0]!;
    observation.identityId = "account-a";
    const identities: IdentityContext[] = [
      {
        id: "account-a",
        label: "Account A",
        role: "user",
        notes: null,
        associatedObservationIds: [observation.id],
      },
    ];
    const asset: Asset = {
      id: "asset-orders",
      label: "Order Record",
      category: "account_data",
      notes: null,
      linkedEndpointIds: [observation.endpointId],
      linkedObservationIds: [observation.id],
      createdAt: "now",
      provenance: "manual",
    };
    const boundary: TrustBoundary = {
      id: "boundary-api",
      label: "Browser to API",
      type: "browser_api",
      notes: null,
      sourceRef: "account-a",
      destinationRef: observation.endpointId,
      createdAt: "now",
      provenance: "manual",
    };
    const hypothesis = generateHypotheses(
      imported.endpoints,
      imported.inputs,
    )[0]!;
    hypothesis.reasoning = {
      category: "ssrf",
      inputId: imported.inputs[0]!.id,
      inputName: imported.inputs[0]!.name,
      inputLocation: imported.inputs[0]!.location,
      signalType: "input_name",
      signalReason: "test destination-like input",
      signalStrength: "moderate",
      valueClass: null,
      followUpQuestion: null,
      teachingContext: "Review only.",
      nextSteps: [],
    };
    const diff = compareObservations("experiment", observation, observation);
    const experiment: Experiment = {
      id: "experiment",
      endpointId: observation.endpointId,
      baselineObservationId: observation.id,
      resultObservationId: observation.id,
      hypothesisId: hypothesis.id,
      mutation: { identity: { fromRole: "user", toRole: "admin" } },
      mutationDescription: "identity: user -> admin",
      comparisonClassification: "controlled",
      requestDifferences: [],
      diff,
      baselineIdentityId: "account-a",
      resultIdentityId: "account-a",
      status: "investigating",
      conclusion: null,
      notes: null,
      evidenceIds: [],
      createdAt: "now",
      updatedAt: "now",
    };
    const graph = buildGraph({
      ...imported,
      identities,
      assets: [asset],
      trustBoundaries: [boundary],
      hypotheses: [hypothesis],
      experiments: [experiment],
    });
    expect(
      graph.nodes.map(({ kind, provenance }) => `${kind}:${provenance}`),
    ).toEqual(
      expect.arrayContaining([
        "endpoint:observed",
        "input:observed",
        "identity:manual",
        "asset:manual",
        "trust_boundary:manual",
        "hypothesis:inferred",
        "experiment:manual",
      ]),
    );
    expect(
      graph.edges.map(({ source, target }) => `${source}->${target}`),
    ).toEqual(
      expect.arrayContaining([
        `${identities[0]!.id}->${observation.endpointId}`,
        `${observation.endpointId}->${asset.id}`,
        `${hypothesis.id}->${observation.endpointId}`,
        `${hypothesis.id}->${imported.inputs[0]!.id}`,
        `${experiment.id}->${hypothesis.id}`,
      ]),
    );
  });
});

describe("runtime scope decision", () => {
  const scope = (overrides: Partial<ProjectScope> = {}): ProjectScope => ({
    id: "scope-1",
    projectId: "project-1",
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
      requestCount: 0,
      repeatedServerErrors: false,
      authenticationLost: false,
      customNote: null,
    },
    notes: null,
    createdAt: "now",
    updatedAt: "now",
    ...overrides,
  });
  const decide = (
    url = "https://example.test/api/users",
    method = "GET",
    configured: ProjectScope | null = scope(),
    rateAvailable = true,
  ) => isRequestInScope({ method, url }, configured, { rateAvailable });

  test.each([
    [null, "https://example.test/api/users", "GET", "NO_ACTIVE_SCOPE"],
    [
      scope({ active: false }),
      "https://example.test/api/users",
      "GET",
      "NO_ACTIVE_SCOPE",
    ],
    [scope(), "not a URL", "GET", "MALFORMED_URL"],
    [
      scope(),
      "https://user:pass@example.test/api/users",
      "GET",
      "USERINFO_NOT_ALLOWED",
    ],
    [scope(), "https://other.test/api/users", "GET", "HOST_NOT_ALLOWED"],
    [scope(), "https://api.example.test/api/users", "GET", "HOST_NOT_ALLOWED"],
    [scope(), "https://evil-example.test/api/users", "GET", "HOST_NOT_ALLOWED"],
    [scope(), "https://192.0.2.10/api/users", "GET", "HOST_NOT_ALLOWED"],
    [scope(), "ftp://example.test/api/users", "GET", "PROTOCOL_NOT_ALLOWED"],
    [scope(), "file:///api/users", "GET", "PROTOCOL_NOT_ALLOWED"],
    [scope(), "gopher://example.test/api/users", "GET", "PROTOCOL_NOT_ALLOWED"],
    [scope(), "data:text/plain,hello", "GET", "PROTOCOL_NOT_ALLOWED"],
    [scope(), "javascript:alert(1)", "GET", "PROTOCOL_NOT_ALLOWED"],
    [scope(), "ws://example.test/api/users", "GET", "PROTOCOL_NOT_ALLOWED"],
    [scope(), "wss://example.test/api/users", "GET", "PROTOCOL_NOT_ALLOWED"],
    [scope(), "https://example.test:8443/api/users", "GET", "PORT_NOT_ALLOWED"],
    [scope(), "https://example.test/api/admin/users", "GET", "PATH_EXCLUDED"],
    [scope(), "https://example.test/api/%61dmin/users", "GET", "PATH_EXCLUDED"],
    [scope(), "https://example.test/public", "GET", "PATH_NOT_ALLOWED"],
    [scope(), "https://example.test/api/users", "DELETE", "METHOD_NOT_ALLOWED"],
    [
      scope({
        stopConditions: { ...scope().stopConditions, manualStop: true },
      }),
      "https://example.test/api/users",
      "GET",
      "MANUAL_STOP_ACTIVE",
    ],
  ] as const)("fails closed for case %#", (configured, url, method, code) => {
    expect(decide(url, method, configured)).toMatchObject({
      allowed: false,
      reasonCode: code,
    });
  });

  test.each([
    ["https://example.test/api/users", scope()],
    ["https://EXAMPLE.TEST./api/users", scope()],
    ["https://example.test:443/api/users", scope()],
    ["https://example.test:8443/api/users", scope({ allowedPorts: [8443] })],
    [
      "http://example.test/api/users",
      scope({ allowedProtocols: ["http"], allowedPorts: [80] }),
    ],
    [
      "https://[2001:db8::1]/api/users",
      scope({ allowedHosts: ["2001:db8::1"] }),
    ],
  ] as const)(
    "allows explicitly configured candidate %#",
    (url, configured) => {
      expect(decide(url, "get", configured)).toMatchObject({
        allowed: true,
        reasonCode: "IN_SCOPE",
      });
    },
  );

  test("exclusions override normalized dot-segment paths", () => {
    expect(
      decide("https://example.test/api/public/../admin/users"),
    ).toMatchObject({
      allowed: false,
      reasonCode: "PATH_EXCLUDED",
    });
  });

  test("double-encoded traversal cannot bypass an excluded path", () => {
    expect(
      decide("https://example.test/api/public/%252e%252e/admin/users"),
    ).toMatchObject({ allowed: false, reasonCode: "PATH_EXCLUDED" });
  });

  test("re-evaluates every redirect target independently", () => {
    expect(
      evaluateRedirectTarget("GET", "https://other.test/api/users", scope()),
    ).toMatchObject({ allowed: false, reasonCode: "HOST_NOT_ALLOWED" });
    expect(
      evaluateRedirectTarget("GET", "https://example.test/api/next", scope()),
    ).toMatchObject({ allowed: true, reasonCode: "IN_SCOPE" });
  });

  test("denies when the rolling request budget is exhausted and resets by time", () => {
    const budget = new RequestBudget();
    const configured = scope();
    expect(budget.consumeRequest(configured, 1_000)).toBe(true);
    expect(budget.consumeRequest(configured, 2_000)).toBe(true);
    expect(budget.canConsumeRequest(configured, 3_000)).toBe(false);
    expect(
      decide("https://example.test/api/users", "GET", configured, false)
        .reasonCode,
    ).toBe("RATE_LIMIT_EXHAUSTED");
    const restored = new RequestBudget();
    restored.restore(configured.id, budget.snapshot(configured.id, 3_000));
    expect(restored.canConsumeRequest(configured, 3_000)).toBe(false);
    expect(budget.canConsumeRequest(configured, 62_000)).toBe(true);
  });

  test.each([
    [{ maxRequestCount: 2, requestCount: 2 }, "MAX_REQUEST_COUNT_REACHED"],
    [{ repeatedServerErrors: true }, "REPEATED_SERVER_ERRORS"],
    [{ authenticationLost: true }, "AUTHENTICATION_LOST"],
  ])("enforces stop condition %#", (stop, reasonCode) => {
    const configured = scope({
      stopConditions: { ...scope().stopConditions, ...stop },
    });
    expect(
      decide("https://example.test/api/users", "GET", configured),
    ).toMatchObject({
      allowed: false,
      reasonCode,
    });
  });

  test("does not treat an SSRF-like body destination as execution permission", () => {
    const configured = scope({ allowedHosts: ["target.example"] });
    expect(
      isRequestInScope(
        {
          method: "POST",
          url: "https://target.example/api/fetch",
          body: { url: "http://internal.example/" },
        },
        configured,
      ),
    ).toMatchObject({ allowed: true, reasonCode: "IN_SCOPE" });
    expect(
      isRequestInScope(
        { method: "GET", url: "http://internal.example/" },
        configured,
      ),
    ).toMatchObject({ allowed: false });
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
