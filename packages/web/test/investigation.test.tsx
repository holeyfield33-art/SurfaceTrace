import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import App from "../src/App";

const endpoint = {
  id: "ep-project",
  method: "GET",
  host: "lab.example.com",
  pathTemplate: "/api/projects/{id}",
  observationCount: 2,
  statusCodes: [200],
};
const observations = [
  {
    id: "obs-100",
    endpointId: endpoint.id,
    method: "GET",
    url: "https://lab.example.com/api/projects/100",
    responseStatus: 200,
    responseSize: 78,
    responseBodyShape: '{"id":"number"}',
    capturedAt: "2026-01-01",
    identityId: null,
    http: {
      request: {
        httpVersion: "HTTP/1.1",
        target: "/api/projects/100?view=full",
        headers: { Host: "lab.example.com", Cookie: "session=[REDACTED]" },
        cookies: { session: "[REDACTED]" },
        query: { view: "full" },
        body: null,
      },
      response: {
        httpVersion: "HTTP/1.1",
        status: 200,
        statusText: "OK",
        headers: { "Content-Type": "application/json" },
        body: '{\n  "id": 100\n}',
      },
    },
    parsedInputs: [
      { name: "id", location: "path", type: "integer", sensitive: false },
      { name: "session", location: "cookie", type: "string", sensitive: true },
    ],
  },
  {
    id: "obs-200",
    endpointId: endpoint.id,
    method: "GET",
    url: "https://lab.example.com/api/projects/200",
    responseStatus: 200,
    responseSize: 76,
    responseBodyShape: '{"id":"number"}',
    capturedAt: "2026-01-02",
    identityId: null,
  },
];
const input = {
  id: "input-id",
  endpointId: endpoint.id,
  name: "id",
  location: "path",
  sampleTypes: ["integer"],
  sensitivity: "normal",
  observedCount: 2,
};
const hypothesis = {
  id: "hyp-auth",
  endpointId: endpoint.id,
  question: "Does the server enforce ownership authorization?",
  signal: "object-id-in-path-or-input",
  priority: 7,
  status: "open",
  observationIds: [],
  experimentIds: [],
  assetIds: [],
  trustBoundaryIds: [],
  evidenceIds: [],
  notes: null,
  provenance: "inferred",
};
const inventory = {
  endpoints: [endpoint],
  observations,
  inputs: [input],
  hypotheses: [hypothesis],
  identities: [
    {
      id: "anonymous",
      label: "Anonymous",
      role: "anonymous",
      notes: null,
      associatedObservationIds: [],
    },
    {
      id: "account-a",
      label: "Account A",
      role: "user",
      notes: null,
      associatedObservationIds: [],
    },
    {
      id: "account-b",
      label: "Account B",
      role: "user",
      notes: null,
      associatedObservationIds: [],
    },
    {
      id: "privileged",
      label: "Privileged/Admin",
      role: "admin",
      notes: null,
      associatedObservationIds: [],
    },
    {
      id: "custom",
      label: "Custom",
      role: "unknown",
      notes: null,
      associatedObservationIds: [],
    },
  ],
  experiments: [] as Array<Record<string, any>>,
  assets: [] as Array<Record<string, any>>,
  trustBoundaries: [] as Array<Record<string, any>>,
  graph: {
    nodes: [
      {
        id: endpoint.id,
        kind: "endpoint",
        label: "GET /api/projects/{id}",
        provenance: "observed",
      },
      { id: input.id, kind: "input", label: "path.id", provenance: "observed" },
      {
        id: hypothesis.id,
        kind: "hypothesis",
        label: hypothesis.question,
        provenance: "inferred",
      },
    ],
    edges: [
      {
        id: "endpoint-input",
        source: endpoint.id,
        target: input.id,
        label: "accepts",
      },
      {
        id: "hypothesis-endpoint",
        source: hypothesis.id,
        target: endpoint.id,
        label: "questions",
      },
    ],
  },
  evidence: [
    {
      id: "import",
      kind: "observation",
      createdAt: "2026-01-01",
      contentHash: "import-hash",
      payload: {},
    },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("investigation loop", () => {
  test("imports, selects graph context, compares one variable, and saves evidence", async () => {
    const user = userEvent.setup();
    let inventoryReads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: RequestInfo | URL) => {
        const url = String(request);
        if (url.endsWith("/api/import/har"))
          return jsonResponse({ observations: 2 });
        if (url.endsWith("/api/experiments"))
          return jsonResponse(
            {
              experiment: { status: "different" },
              diff: { summary: "Size delta: -2" },
              evidence: [{ kind: "experiment" }, { kind: "diff" }],
            },
            201,
          );
        if (url.endsWith("/api/inventory")) {
          inventoryReads += 1;
          return jsonResponse(
            inventoryReads > 2
              ? {
                  ...inventory,
                  evidence: [
                    ...inventory.evidence,
                    {
                      id: "experiment",
                      kind: "experiment",
                      createdAt: "2026-01-02",
                      contentHash: "experiment-hash",
                      payload: {},
                    },
                    {
                      id: "diff",
                      kind: "diff",
                      createdAt: "2026-01-02",
                      contentHash: "diff-hash",
                      payload: {},
                    },
                  ],
                }
              : inventory,
          );
        }
        return jsonResponse({ error: "unexpected request" }, 404);
      }),
    );

    render(<App />);
    const fileInput =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).toBeTruthy();
    const file = new File(["{}"], "sample.har", { type: "application/json" });
    Object.defineProperty(file, "text", { value: async () => "{}" });
    await user.upload(fileInput!, file);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("/api/projects/{id}")).toBeTruthy();
    await user.click(
      await screen.findByRole("button", { name: "INVESTIGATION" }),
    );
    await user.click(
      await screen.findByRole("button", {
        name: /GET \/api\/projects\/\{id\}/,
      }),
    );
    expect(
      screen.getByText(/GET \/api\/projects\/100\?view=full HTTP\/1.1/),
    ).toBeTruthy();
    expect(screen.getByText(/Cookie: session=\[REDACTED\]/)).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "RESPONSE" }));
    expect(screen.getByText(/HTTP\/1.1 200 OK/)).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "PARSED" }));
    expect(screen.getByText("path.id")).toBeTruthy();
    expect(screen.getByText("cookie.session")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "DIFF" }));
    expect(
      screen.getByText("No comparison recorded for this investigation."),
    ).toBeTruthy();
    await user.click(
      screen.getByRole("button", {
        name: /Does the server enforce ownership authorization/,
      }),
    );
    await user.selectOptions(
      screen.getByLabelText("Baseline observation"),
      "obs-100",
    );
    await user.selectOptions(
      screen.getByLabelText("Changed input"),
      "input-id",
    );
    await user.type(screen.getByLabelText("Baseline value"), "100");
    await user.type(screen.getByLabelText("Changed value"), "200");
    await user.selectOptions(
      screen.getByLabelText("Result observation"),
      "obs-200",
    );
    await user.type(
      screen.getByLabelText("Evidence note"),
      "Compare authorized captures",
    );
    await user.click(
      screen.getByRole("button", { name: "COMPARE + SAVE EVIDENCE" }),
    );
    expect(await screen.findAllByText("Size delta: -2")).toHaveLength(2);
    expect(
      screen.getByText("2 hash-linked evidence records saved"),
    ).toBeTruthy();
  });

  test("assigns, persists, and compares explicit identities without a vulnerability verdict", async () => {
    const user = userEvent.setup();
    const current = structuredClone(inventory);
    const experimentBodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
        const url = String(request);
        if (url.endsWith("/api/import/har"))
          return jsonResponse({ observations: 2 });
        if (url.endsWith("/api/inventory")) return jsonResponse(current);
        if (url.includes("/api/observations/") && url.endsWith("/identity")) {
          const observationId = url.split("/").at(-2)!;
          const { identityId } = JSON.parse(String(init?.body)) as {
            identityId: string;
          };
          current.observations.find(
            (item) => item.id === observationId,
          )!.identityId = identityId;
          return jsonResponse({
            observation: { id: observationId, identityId },
          });
        }
        if (url.endsWith("/api/experiments")) {
          experimentBodies.push(JSON.parse(String(init?.body)));
          return jsonResponse(
            {
              experiment: { status: "different" },
              diff: { summary: "Size delta: -2" },
              evidence: [{}, {}],
            },
            201,
          );
        }
        return jsonResponse({ error: "unexpected request" }, 404);
      }),
    );

    render(<App />);
    const file = new File(["{}"], "sample.har", { type: "application/json" });
    Object.defineProperty(file, "text", { value: async () => "{}" });
    await user.upload(
      document.querySelector<HTMLInputElement>('input[type="file"]')!,
      file,
    );
    await user.click(
      await screen.findByRole("button", { name: "INVESTIGATION" }),
    );

    expect(
      screen.getAllByText(/Observed as: Unassigned/).length,
    ).toBeGreaterThan(0);
    await user.selectOptions(screen.getByLabelText("Observed as"), "account-a");
    await waitFor(() =>
      expect(
        screen.getByLabelText<HTMLSelectElement>("Observed as").value,
      ).toBe("account-a"),
    );
    expect(screen.getByText("Observed as: Account A")).toBeTruthy();

    await user.selectOptions(screen.getByLabelText("Observation"), "obs-200");
    await user.selectOptions(screen.getByLabelText("Observed as"), "account-b");
    await waitFor(() =>
      expect(screen.getByText("Observed as: Account B")).toBeTruthy(),
    );
    await user.selectOptions(
      screen.getByLabelText("Identity baseline observation"),
      "obs-100",
    );
    await user.selectOptions(
      screen.getByLabelText("Identity comparison observation"),
      "obs-200",
    );
    expect(screen.getByText("Account A -> Account B")).toBeTruthy();
    expect(
      screen.getByText(
        /OBSERVATIONAL COMPARISON \/ multiple differences detected/,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("Does Account B receive data belonging to Account A?"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Does the same resource behave differently for Anonymous vs authenticated identities?",
      ),
    ).toBeTruthy();
    await user.click(
      screen.getByRole("button", {
        name: "COMPARE IDENTITIES + SAVE EVIDENCE",
      }),
    );
    expect(await screen.findByText("DETERMINISTIC RESPONSE DIFF")).toBeTruthy();
    expect(experimentBodies[0]).toMatchObject({
      mutation: { identity: { fromRole: "user", toRole: "user" } },
    });

    await user.selectOptions(screen.getByLabelText("Observation"), "obs-100");
    await user.selectOptions(screen.getByLabelText("Observed as"), "anonymous");
    await waitFor(() =>
      expect(screen.getByText("Observed as: Anonymous")).toBeTruthy(),
    );
    expect(document.body.textContent).not.toMatch(
      /VULNERABLE|IDOR CONFIRMED|BOLA CONFIRMED|PRIVILEGE ESCALATION CONFIRMED/,
    );
  });

  test("reviews, filters, and updates a complete experiment notebook record", async () => {
    const user = userEvent.setup();
    const current = structuredClone(inventory);
    current.observations[0]!.identityId = "account-a";
    current.observations[1]!.identityId = "account-b";
    current.experiments.push({
      id: "exp-1",
      endpointId: endpoint.id,
      hypothesisId: hypothesis.id,
      baselineObservationId: "obs-100",
      resultObservationId: "obs-200",
      baselineIdentityId: "account-a",
      resultIdentityId: "account-b",
      mutationDescription: "identity: Account A -> Account B",
      comparisonClassification: "observational",
      requestDifferences: ["identity", "path.id", "header.accept-language"],
      diff: {
        summary: "2 response field changes",
        statusChanged: false,
        headerChanges: [],
        bodyComparison: "different",
        bodyChangeCount: 2,
        bodyChanges: [
          {
            path: "user.email",
            changeType: "type_changed",
            before: null,
            after: "other@example.test",
          },
          {
            path: "user.role",
            changeType: "value_changed",
            before: "user",
            after: "admin",
          },
        ],
        truncated: false,
        truncationReason: null,
      },
      conclusion: null,
      notes: "Review ownership behavior",
      status: "candidate_finding",
      evidenceIds: ["evidence-created", "evidence-diff"],
      createdAt: "2026-01-03T00:00:00.000Z",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
        const url = String(request);
        if (url.endsWith("/api/import/har"))
          return jsonResponse({ observations: 2 });
        if (url.endsWith("/api/inventory")) return jsonResponse(current);
        if (url.endsWith("/api/experiments/exp-1")) {
          Object.assign(
            current.experiments[0]!,
            JSON.parse(String(init?.body)),
          );
          return jsonResponse({
            experiment: current.experiments[0],
            evidence: { id: "lifecycle" },
          });
        }
        return jsonResponse({ error: "unexpected request" }, 404);
      }),
    );
    render(<App />);
    const file = new File(["{}"], "sample.har", { type: "application/json" });
    Object.defineProperty(file, "text", { value: async () => "{}" });
    await user.upload(
      document.querySelector<HTMLInputElement>('input[type="file"]')!,
      file,
    );
    await user.click(
      await screen.findByRole("button", { name: "INVESTIGATION" }),
    );

    expect(screen.getByText("Review the investigation record.")).toBeTruthy();
    expect(
      screen.getByText(
        "Candidate finding - requires reproduction and tester validation.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Controlled experiment: NO")).toBeTruthy();
    expect(screen.getByText("header.accept-language")).toBeTruthy();
    expect(screen.getByText("user.email")).toBeTruthy();
    expect(screen.getByText('"other@example.test"')).toBeTruthy();
    expect(screen.getByText("FIELDS CHANGED")).toBeTruthy();
    expect(screen.getByText("evidence-created")).toBeTruthy();
    await user.selectOptions(
      screen.getByLabelText("Filter experiments by status"),
      "closed",
    );
    expect(
      screen.getByText("No experiments match these filters."),
    ).toBeTruthy();
    await user.selectOptions(
      screen.getByLabelText("Filter experiments by status"),
      "candidate_finding",
    );
    await user.selectOptions(
      screen.getByLabelText("Filter experiments by endpoint"),
      endpoint.id,
    );
    await user.selectOptions(
      screen.getByLabelText("Filter experiments by identity"),
      "account-a",
    );
    expect(
      screen.getByText("Candidate Finding / 2 response field changes"),
    ).toBeTruthy();
    await user.selectOptions(
      screen.getByLabelText("Tester conclusion"),
      "needs_more_testing",
    );
    await waitFor(() =>
      expect(current.experiments[0]!.conclusion).toBe("needs_more_testing"),
    );
    await user.clear(screen.getByLabelText("Experiment notes"));
    await user.type(
      screen.getByLabelText("Experiment notes"),
      "Tester-authored follow-up",
    );
    await user.click(screen.getByRole("button", { name: "SAVE NOTES" }));
    await waitFor(() =>
      expect(current.experiments[0]!.notes).toBe("Tester-authored follow-up"),
    );
  });

  test("manages threat annotations, hypothesis lifecycle, provenance, and graph links", async () => {
    const user = userEvent.setup();
    const current = structuredClone(inventory);
    current.observations[0]!.identityId = "account-a";
    function rebuildGraph(): void {
      current.graph.nodes = [
        {
          id: endpoint.id,
          kind: "endpoint",
          label: "GET /api/projects/{id}",
          provenance: "observed",
        },
        {
          id: input.id,
          kind: "input",
          label: "path.id",
          provenance: "observed",
        },
        {
          id: "account-a",
          kind: "identity",
          label: "Account A",
          provenance: "manual",
        },
        {
          id: hypothesis.id,
          kind: "hypothesis",
          label: hypothesis.question,
          provenance: "inferred",
        },
        ...current.assets.map((item) => ({
          id: item.id,
          kind: "asset",
          label: item.label,
          provenance: "manual",
        })),
        ...current.trustBoundaries.map((item) => ({
          id: item.id,
          kind: "trust_boundary",
          label: item.label,
          provenance: "manual",
        })),
      ];
      current.graph.edges = [
        {
          id: "identity-endpoint",
          source: "account-a",
          target: endpoint.id,
          label: "observed as",
        },
        {
          id: "endpoint-input",
          source: endpoint.id,
          target: input.id,
          label: "accepts",
        },
        {
          id: "hypothesis-endpoint",
          source: hypothesis.id,
          target: endpoint.id,
          label: "questions",
        },
        ...current.assets.map((item) => ({
          id: `asset-${item.id}`,
          source: endpoint.id,
          target: item.id,
          label: "handles",
        })),
        ...current.trustBoundaries.map((item) => ({
          id: `boundary-${item.id}`,
          source: item.sourceRef,
          target: item.id,
          label: "crosses",
        })),
      ];
    }
    rebuildGraph();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
        const url = String(request);
        const method = init?.method ?? "GET";
        if (url.endsWith("/api/import/har"))
          return jsonResponse({ observations: 2 });
        if (url.endsWith("/api/inventory")) return jsonResponse(current);
        if (url.endsWith("/api/assets") && method === "POST") {
          const body = JSON.parse(String(init?.body));
          const asset = {
            id: "asset-1",
            ...body,
            linkedObservationIds: [],
            provenance: "manual",
          };
          current.assets.push(asset);
          rebuildGraph();
          return jsonResponse(asset, 201);
        }
        if (url.endsWith("/api/assets/asset-1") && method === "PATCH") {
          Object.assign(current.assets[0]!, JSON.parse(String(init?.body)));
          rebuildGraph();
          return jsonResponse(current.assets[0]);
        }
        if (url.endsWith("/api/assets/asset-1") && method === "DELETE") {
          current.assets.splice(0, 1);
          rebuildGraph();
          return jsonResponse({});
        }
        if (url.endsWith("/api/trust-boundaries") && method === "POST") {
          const body = JSON.parse(String(init?.body));
          const boundary = { id: "boundary-1", ...body, provenance: "manual" };
          current.trustBoundaries.push(boundary);
          rebuildGraph();
          return jsonResponse(boundary, 201);
        }
        if (
          url.endsWith("/api/trust-boundaries/boundary-1") &&
          method === "PATCH"
        ) {
          Object.assign(
            current.trustBoundaries[0]!,
            JSON.parse(String(init?.body)),
          );
          rebuildGraph();
          return jsonResponse(current.trustBoundaries[0]);
        }
        if (
          url.endsWith("/api/trust-boundaries/boundary-1") &&
          method === "DELETE"
        ) {
          current.trustBoundaries.splice(0, 1);
          rebuildGraph();
          return jsonResponse({});
        }
        if (
          url.endsWith(`/api/hypotheses/${hypothesis.id}`) &&
          method === "PATCH"
        ) {
          Object.assign(current.hypotheses[0]!, JSON.parse(String(init?.body)));
          return jsonResponse({
            hypothesis: current.hypotheses[0],
            evidence: { id: "hyp-evidence" },
          });
        }
        return jsonResponse({ error: "unexpected request" }, 404);
      }),
    );
    render(<App />);
    const file = new File(["{}"], "sample.har", { type: "application/json" });
    Object.defineProperty(file, "text", { value: async () => "{}" });
    await user.upload(
      document.querySelector<HTMLInputElement>('input[type="file"]')!,
      file,
    );
    await user.click(
      await screen.findByRole("button", { name: "INVESTIGATION" }),
    );
    expect(screen.getAllByText("OBSERVED").length).toBeGreaterThan(0);
    expect(screen.getAllByText("MANUAL").length).toBeGreaterThan(0);
    expect(screen.getAllByText("INFERRED").length).toBeGreaterThan(0);
    await user.type(screen.getByLabelText("Asset label"), "Project Owner Data");
    await user.selectOptions(screen.getByLabelText("Asset category"), "pii");
    await user.click(screen.getByRole("button", { name: "ADD ASSET" }));
    expect(
      (await screen.findAllByText("Project Owner Data")).length,
    ).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "EDIT" }));
    await user.clear(screen.getByLabelText("Asset label"));
    await user.type(
      screen.getByLabelText("Asset label"),
      "Project Account Data",
    );
    await user.click(screen.getByRole("button", { name: "SAVE ASSET" }));
    expect(
      (await screen.findAllByText("Project Account Data")).length,
    ).toBeGreaterThan(0);
    await user.type(
      screen.getByLabelText("Boundary label"),
      "Browser to Project API",
    );
    await user.selectOptions(
      screen.getByLabelText("Boundary type"),
      "browser_api",
    );
    await user.click(screen.getByRole("button", { name: "ADD BOUNDARY" }));
    expect(
      (await screen.findAllByText("Browser to Project API")).length,
    ).toBeGreaterThan(0);
    await user.selectOptions(
      screen.getByLabelText(`Status for ${hypothesis.question}`),
      "supported",
    );
    expect(
      await screen.findByText(
        /Supported means evidence supports continuing this hypothesis/,
      ),
    ).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "LINK CURRENT CONTEXT" }),
    );
    await waitFor(() =>
      expect(current.hypotheses[0]!.assetIds).toEqual(["asset-1"]),
    );
    expect(screen.getAllByText(/Account A/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Project Account Data/).length).toBeGreaterThan(
      0,
    );
    await user.click(screen.getAllByRole("button", { name: "REMOVE" })[0]!);
    await waitFor(() => expect(current.assets).toEqual([]));
    await user.click(screen.getByRole("button", { name: "REMOVE" }));
    await waitFor(() => expect(current.trustBoundaries).toEqual([]));
  });

  test("renders an inferred SSRF review card with teaching and manual context", async () => {
    const user = userEvent.setup();
    const current = structuredClone(inventory);
    current.inputs = [
      {
        ...input,
        id: "input-image-url",
        name: "imageUrl",
        location: "body-json",
      },
    ];
    current.assets = [
      {
        id: "asset-image",
        label: "Imported Image",
        category: "documents_files",
        notes: null,
        linkedEndpointIds: [endpoint.id],
        linkedObservationIds: [],
        provenance: "manual",
      },
    ];
    current.trustBoundaries = [
      {
        id: "boundary-third-party",
        label: "Application to Third Party",
        type: "application_third_party",
        notes: null,
        sourceRef: "account-a",
        destinationRef: endpoint.id,
        provenance: "manual",
      },
    ];
    current.hypotheses = [
      {
        ...hypothesis,
        id: "hyp-ssrf",
        question:
          "Does body-json.imageUrl cause the application server to retrieve the supplied destination?",
        signal: "server-side-outbound-request-review",
        evidenceIds: ["ssrf-evidence"],
        reasoning: {
          category: "ssrf",
          inputId: "input-image-url",
          inputName: "imageUrl",
          inputLocation: "body-json",
          signalType: "absolute_url",
          signalReason:
            "body-json.imageUrl contains an absolute HTTP/HTTPS URL",
          signalStrength: "strong",
          valueClass: "absolute URL",
          followUpQuestion:
            "If server-side fetching occurs, what destinations, protocols, and trust boundaries are permitted?",
          teachingContext:
            "This input appears capable of describing a destination. SSRF becomes relevant only if the SERVER, rather than the browser, uses that value to make another request. You have not established that yet.",
          nextSteps: [
            "Does the browser fetch it or does the server?",
            "Is a network trust boundary crossed?",
          ],
        },
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: RequestInfo | URL) => {
        const url = String(request);
        if (url.endsWith("/api/import/har"))
          return jsonResponse({ observations: 2 });
        if (url.endsWith("/api/inventory")) return jsonResponse(current);
        return jsonResponse({ error: "unexpected request" }, 404);
      }),
    );
    render(<App />);
    const file = new File(["{}"], "sample.har", { type: "application/json" });
    Object.defineProperty(file, "text", { value: async () => "{}" });
    await user.upload(
      document.querySelector<HTMLInputElement>('input[type="file"]')!,
      file,
    );
    await user.click(
      await screen.findByRole("button", { name: "INVESTIGATION" }),
    );
    expect(screen.getByText("INFERRED REVIEW QUESTION")).toBeTruthy();
    expect(screen.getByText("absolute URL")).toBeTruthy();
    expect(
      screen.getAllByText(/Application to Third Party/).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/Imported Image/).length).toBeGreaterThan(0);
    expect(screen.getByText("WHY THIS MATTERS")).toBeTruthy();
    expect(screen.getByText(/You have not established that yet/)).toBeTruthy();
    expect(screen.queryByText(/SSRF FOUND/i)).toBeNull();
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
