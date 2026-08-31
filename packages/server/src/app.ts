import cors from "@fastify/cors";
import Fastify from "fastify";
import {
  EvidenceLedger,
  RequestBudget,
  REDACTED,
  assertOneVariable,
  buildGraph,
  compareObservations,
  bodyShape,
  describeMutation,
  generateHypotheses,
  hashPayload,
  importHar,
  isRequestInScope,
  evaluateRedirectTarget,
  parseHarJson,
  redactBody,
  redactHeaders,
  sanitizeUrl,
} from "@surfacetrace/core";
import {
  reconstructRequest,
  type ReconstructedRequest,
  type RuntimeCredential,
} from "./replay/reconstruct.js";
import { executeReplayRequest } from "./replay/httpClient.js";
import type {
  Asset,
  AssetCategory,
  Experiment,
  ExperimentMutation,
  ExperimentStatus,
  HypothesisStatus,
  HttpMethod,
  IdentityContext,
  InputDescriptor,
  Observation,
  ProjectScope,
  TesterConclusion,
  TrustBoundary,
  TrustBoundaryType,
} from "@surfacetrace/core";
import {
  SqlitePersistence,
  type ImportRecord,
  type PersistedState,
} from "./persistence.js";

const EXPERIMENT_STATUSES = new Set<ExperimentStatus>([
  "open",
  "investigating",
  "same",
  "different",
  "needs_review",
  "candidate_finding",
  "closed",
]);
const TESTER_CONCLUSIONS = new Set<TesterConclusion>([
  "no_meaningful_difference",
  "expected_difference",
  "unexpected_difference",
  "needs_more_testing",
  "potential_security_issue",
  "not_reproducible",
]);
const ASSET_CATEGORIES = new Set<AssetCategory>([
  "pii",
  "account_data",
  "payment_data",
  "credentials_secrets",
  "documents_files",
  "administrative_function",
  "internal_service_data",
  "custom",
]);
const BOUNDARY_TYPES = new Set<TrustBoundaryType>([
  "browser_api",
  "public_authenticated",
  "user_privileged",
  "application_third_party",
  "application_internal_service",
  "custom",
]);
const HYPOTHESIS_STATUSES = new Set<HypothesisStatus>([
  "open",
  "investigating",
  "supported",
  "not_supported",
  "needs_more_evidence",
  "closed",
]);
const HTTP_METHODS = new Set<HttpMethod>([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

export interface AppOptions {
  maxBodyBytes?: number;
  maxHarEntries?: number;
  allowedOrigins?: string[];
  logger?: boolean;
  dbPath?: string;
  replayTimeoutMs?: number;
  maxReplayResponseBytes?: number;
}

function defaultIdentities(): IdentityContext[] {
  return [
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
  ];
}

export function buildApp(options: AppOptions = {}) {
  const maxBodyBytes = options.maxBodyBytes ?? 10 * 1024 * 1024;
  const maxHarEntries = options.maxHarEntries ?? 5000;
  const allowedOrigins = new Set(
    options.allowedOrigins ?? [
      "http://127.0.0.1:5173",
      "http://localhost:5173",
    ],
  );
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: maxBodyBytes,
  });
  const persistence = new SqlitePersistence(
    options.dbPath ??
      (process.env.NODE_ENV === "test"
        ? ":memory:"
        : (process.env.SURFACETRACE_DB_PATH ?? "./data/surfacetrace.db")),
  );
  let activeProject =
    persistence.listProjects()[0] ??
    persistence.createProject("Untitled Investigation");
  const restored = persistence.load(activeProject.id);
  let activeImport: ImportRecord | null = restored?.activeImport ?? null;
  let ledger = new EvidenceLedger(restored?.evidence ?? []);
  let projectScope: ProjectScope | null = restored?.scope ?? null;
  const requestBudget = new RequestBudget();
  if (projectScope)
    requestBudget.restore(
      projectScope.id,
      projectScope.rateWindowTimestamps ?? [],
    );
  const runtimeCredentials = new Map<string, RuntimeCredential>();
  const preparedReplays = new Map<
    string,
    {
      baseline: Observation;
      request: ReconstructedRequest;
      mutation: ExperimentMutation;
      hypothesisId: string | null;
      preparedAt: string;
      evidenceIds: string[];
    }
  >();
  const forcePersistRequests = new WeakSet<object>();
  const changedImportRequests = new WeakSet<object>();
  let experiments: Experiment[] = restored?.experiments ?? [];
  let assets: Asset[] = restored?.assets ?? [];
  let trustBoundaries: TrustBoundary[] = restored?.trustBoundaries ?? [];
  let lastImport: ReturnType<typeof importHar> | null = null;
  let lastGraph: ReturnType<typeof buildGraph> | null = null;
  let lastHypotheses: ReturnType<typeof generateHypotheses> | null = restored
    ?.hypotheses.length
    ? restored.hypotheses
    : null;
  let identities: IdentityContext[] = restored?.identities.length
    ? restored.identities
    : defaultIdentities();
  if (restored?.activeImport) {
    lastImport = {
      observations: restored.observations,
      endpoints: restored.endpoints,
      inputs: restored.inputs,
      skippedEntries: restored.activeImport.skippedEntryCount,
    };
  }
  const requestSnapshots = new WeakMap<object, PersistedState>();
  const newImportRequests = new WeakSet<object>();

  function state(): PersistedState {
    return {
      project: activeProject,
      activeImport,
      observations: lastImport?.observations ?? [],
      endpoints: lastImport?.endpoints ?? [],
      inputs: lastImport?.inputs ?? [],
      identities,
      assets,
      trustBoundaries,
      hypotheses: lastHypotheses ?? [],
      experiments,
      evidence: [...ledger.all()],
      scope: projectScope,
    };
  }

  function restoreState(snapshot: PersistedState): void {
    activeProject = snapshot.project;
    activeImport = snapshot.activeImport;
    lastImport = snapshot.activeImport
      ? {
          observations: snapshot.observations,
          endpoints: snapshot.endpoints,
          inputs: snapshot.inputs,
          skippedEntries: snapshot.activeImport.skippedEntryCount,
        }
      : null;
    identities = snapshot.identities.length
      ? snapshot.identities
      : defaultIdentities();
    assets = snapshot.assets;
    trustBoundaries = snapshot.trustBoundaries;
    lastHypotheses = snapshot.hypotheses.length ? snapshot.hypotheses : null;
    experiments = snapshot.experiments;
    ledger = new EvidenceLedger(snapshot.evidence);
    projectScope = snapshot.scope;
    if (projectScope)
      requestBudget.restore(
        projectScope.id,
        projectScope.rateWindowTimestamps ?? [],
      );
    refreshGraph();
  }

  function refreshGraph(): void {
    if (!lastImport || !lastHypotheses) return;
    lastGraph = buildGraph({
      ...lastImport,
      identities,
      assets,
      trustBoundaries,
      hypotheses: lastHypotheses,
      experiments,
    });
  }
  refreshGraph();

  app.addHook("onRequest", async (request) => {
    if (["POST", "PATCH", "DELETE"].includes(request.method))
      requestSnapshots.set(request, structuredClone(state()));
  });
  app.addHook("onSend", async (request, reply, payload) => {
    const snapshot = requestSnapshots.get(request);
    if (
      snapshot &&
      (reply.statusCode < 400 || forcePersistRequests.has(request))
    ) {
      try {
        activeProject.updatedAt = new Date().toISOString();
        persistence.save(
          state(),
          newImportRequests.has(request),
          changedImportRequests.has(request),
        );
      } catch (error) {
        restoreState(snapshot);
        throw error;
      }
    }
    requestSnapshots.delete(request);
    return payload;
  });
  app.addHook("onClose", async () => persistence.close());

  void app.register(cors, {
    origin(origin, callback) {
      callback(null, !origin || allowedOrigins.has(origin));
    },
  });
  app.setErrorHandler((error, _request, reply) => {
    const fastifyError = error as {
      code?: string;
      statusCode?: number;
      message?: string;
    };
    if (fastifyError.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      return reply
        .status(413)
        .send({ error: `HAR upload exceeds ${maxBodyBytes} bytes` });
    }
    app.log.error(error);
    return reply.status(fastifyError.statusCode ?? 500).send({
      error: fastifyError.statusCode
        ? fastifyError.message
        : "Internal server error",
    });
  });

  app.get("/health", async () => ({
    ok: true,
    service: "surfacetrace-server",
    version: "0.1.0",
    ledgerTip: ledger.tipHash(),
    ledgerValid: ledger.verify(),
    schemaVersion: persistence.schemaVersion(),
  }));
  app.get("/projects", async () => ({
    projects: persistence.listProjects(),
    activeProjectId: activeProject.id,
  }));
  app.post<{ Body: { name?: string } }>("/projects", async (request, reply) => {
    const project = persistence.createProject(
      request.body?.name?.trim() || "Untitled Investigation",
    );
    return reply.status(201).send(project);
  });
  app.post<{ Params: { projectId: string } }>(
    "/projects/:projectId/open",
    async (request, reply) => {
      const loaded = persistence.load(request.params.projectId);
      if (!loaded)
        return reply.status(404).send({ error: "Project not found" });
      restoreState(loaded);
      return {
        project: activeProject,
        inventoryAvailable: Boolean(lastImport),
      };
    },
  );
  app.get<{ Params: { projectId: string } }>(
    "/projects/:projectId/imports",
    async (request, reply) => {
      if (!persistence.load(request.params.projectId))
        return reply.status(404).send({ error: "Project not found" });
      return { imports: persistence.listImports(request.params.projectId) };
    },
  );
  app.post<{ Body: { har: string; sourceLabel?: string } }>(
    "/import/har",
    async (request, reply) => {
      const { har: raw } = request.body ?? {};
      if (!raw || typeof raw !== "string")
        return reply.status(400).send({ error: "body.har (string) required" });
      let har;
      try {
        har = parseHarJson(raw);
      } catch (error) {
        return reply.status(400).send({
          error: "Invalid HAR JSON",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
      if (har.log.entries.length > maxHarEntries) {
        return reply.status(400).send({
          error: `HAR contains ${har.log.entries.length} entries; maximum is ${maxHarEntries}`,
        });
      }
      let result;
      try {
        result = importHar(har);
      } catch (error) {
        return reply.status(400).send({
          error: "HAR could not be normalized",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
      const hypotheses = generateHypotheses(
        result.endpoints,
        result.inputs,
        result.observations,
      );
      lastImport = result;
      lastHypotheses = hypotheses;
      activeImport = {
        id: crypto.randomUUID(),
        projectId: activeProject.id,
        createdAt: new Date().toISOString(),
        observationCount: result.observations.length,
        skippedEntryCount: result.skippedEntries,
        sourceLabel: request.body.sourceLabel?.trim() || "HAR import",
      };
      newImportRequests.add(request);
      for (const hypothesis of hypotheses.filter(
        (item) => item.reasoning?.category === "ssrf",
      )) {
        const reasoning = hypothesis.reasoning!;
        const evidence = ledger.append("note", {
          endpointId: hypothesis.endpointId,
          inputId: reasoning.inputId,
          signalType: reasoning.signalType,
          signalReason: reasoning.signalReason,
          generatedQuestion: hypothesis.question,
          provenance: "inferred",
        });
        hypothesis.evidenceIds.push(evidence.id);
      }
      refreshGraph();
      ledger.append("observation", {
        count: result.observations.length,
        endpoints: result.endpoints.length,
        skippedEntries: result.skippedEntries,
      });
      return {
        observations: result.observations.length,
        skippedEntries: result.skippedEntries,
        endpoints: result.endpoints.length,
        inputs: result.inputs.length,
        hypotheses: hypotheses.length,
        graph: {
          nodes: lastGraph!.nodes.length,
          edges: lastGraph!.edges.length,
        },
        evidenceTip: ledger.tipHash(),
      };
    },
  );

  app.get(
    "/graph",
    async (_request, reply) =>
      lastGraph ??
      reply.status(404).send({ error: "No graph yet - import a HAR first" }),
  );
  app.get(
    "/endpoints",
    async (_request, reply) =>
      lastImport?.endpoints ??
      reply.status(404).send({ error: "No import yet" }),
  );
  app.get(
    "/hypotheses",
    async (_request, reply) =>
      lastHypotheses ?? reply.status(404).send({ error: "No hypotheses yet" }),
  );
  app.get("/evidence", async () => ({
    records: ledger.all(),
    valid: ledger.verify(),
    tip: ledger.tipHash(),
  }));
  app.get("/scope", async () => ({
    scope: projectScope,
    status: projectScope?.active ? "ACTIVE_SCOPE" : "NO_ACTIVE_SCOPE",
  }));
  app.put<{ Body: Partial<ProjectScope> }>("/scope", async (request, reply) => {
    const body = request.body ?? {};
    const protocols = unique(body.allowedProtocols).map((item) =>
      item.toLowerCase(),
    );
    const methods = unique(body.allowedMethods).map((item) =>
      item.toUpperCase(),
    );
    const hosts = unique(body.allowedHosts).map((item) =>
      item.trim().toLowerCase().replace(/\.$/, ""),
    );
    const ports = [...new Set(body.allowedPorts ?? [])].sort((a, b) => a - b);
    const allowedPaths = unique(body.allowedPathPrefixes);
    const excludedPaths = unique(body.excludedPathPrefixes);
    if (
      !hosts.length ||
      hosts.some((item) => !item || /[\s/@]/.test(item)) ||
      !protocols.length ||
      protocols.some((item) => !["http", "https"].includes(item)) ||
      !ports.length ||
      ports.some(
        (item) => !Number.isInteger(item) || item < 1 || item > 65535,
      ) ||
      !allowedPaths.length ||
      [...allowedPaths, ...excludedPaths].some(
        (item) => !item.startsWith("/"),
      ) ||
      !methods.length ||
      methods.some((item) => !HTTP_METHODS.has(item as HttpMethod)) ||
      !Number.isInteger(body.maxRequestsPerMinute) ||
      Number(body.maxRequestsPerMinute) < 1 ||
      (body.stopConditions?.maxRequestCount !== null &&
        body.stopConditions?.maxRequestCount !== undefined &&
        (!Number.isInteger(body.stopConditions.maxRequestCount) ||
          Number(body.stopConditions.maxRequestCount) < 1))
    )
      return reply
        .status(400)
        .send({ error: "Invalid fail-closed scope configuration" });
    const now = new Date().toISOString();
    const previous = projectScope;
    projectScope = {
      id: previous?.id ?? crypto.randomUUID(),
      projectId: activeProject.id,
      active: body.active === true,
      allowedHosts: hosts,
      allowedProtocols: protocols as ProjectScope["allowedProtocols"],
      allowedPorts: ports,
      allowedPathPrefixes: allowedPaths,
      excludedPathPrefixes: excludedPaths,
      allowedMethods: methods as HttpMethod[],
      maxRequestsPerMinute: Number(body.maxRequestsPerMinute),
      rateWindowTimestamps: previous?.rateWindowTimestamps ?? [],
      stopConditions: {
        manualStop: body.stopConditions?.manualStop === true,
        maxRequestCount:
          body.stopConditions?.maxRequestCount === null ||
          body.stopConditions?.maxRequestCount === undefined
            ? null
            : Number(body.stopConditions.maxRequestCount),
        requestCount: previous?.stopConditions.requestCount ?? 0,
        repeatedServerErrors:
          body.stopConditions?.repeatedServerErrors === true,
        authenticationLost: body.stopConditions?.authenticationLost === true,
        customNote: redactBody(body.stopConditions?.customNote, "text/plain"),
      },
      notes: redactBody(body.notes, "text/plain"),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    const event = !previous
      ? "scope_created"
      : previous.active && !projectScope.active
        ? "scope_disabled"
        : !previous.stopConditions.manualStop &&
            projectScope.stopConditions.manualStop
          ? "manual_stop_activated"
          : previous.stopConditions.manualStop &&
              !projectScope.stopConditions.manualStop
            ? "manual_stop_cleared"
            : "scope_updated";
    ledger.append("scope", {
      event,
      projectId: activeProject.id,
      scopeId: projectScope.id,
      active: projectScope.active,
    });
    return { scope: projectScope, evidenceTip: ledger.tipHash() };
  });
  app.post<{ Body: { method: string; url: string; body?: unknown } }>(
    "/scope/preview",
    async (request) => ({
      decision: isRequestInScope(
        {
          method: request.body?.method ?? "",
          url: request.body?.url ?? "",
          body: request.body?.body,
        },
        projectScope,
        {
          rateAvailable: projectScope
            ? requestBudget.canConsumeRequest(projectScope)
            : false,
        },
      ),
      requestSent: false,
    }),
  );
  app.post<{ Body: { method: string; redirectUrl: string } }>(
    "/scope/redirect-preview",
    async (request) => ({
      decision: evaluateRedirectTarget(
        request.body?.method ?? "",
        request.body?.redirectUrl ?? "",
        projectScope,
        {
          rateAvailable: projectScope
            ? requestBudget.canConsumeRequest(projectScope)
            : false,
        },
      ),
      redirectFollowed: false,
    }),
  );
  app.post("/scope/budget/consume", async (_request, reply) => {
    if (!projectScope?.active)
      return reply.status(409).send({ error: "No active project scope" });
    if (!requestBudget.consumeRequest(projectScope))
      return reply.status(429).send({
        decision: isRequestInScope(
          { method: "GET", url: "https://invalid.local/" },
          projectScope,
          { rateAvailable: false },
        ),
      });
    projectScope.stopConditions.requestCount += 1;
    projectScope.rateWindowTimestamps = requestBudget.snapshot(projectScope.id);
    projectScope.updatedAt = new Date().toISOString();
    return {
      consumed: true,
      requestCount: projectScope.stopConditions.requestCount,
    };
  });
  app.put<{
    Params: { identityId: string };
    Body: RuntimeCredential;
  }>("/replay/credentials/:identityId", async (request, reply) => {
    const identity = identities.find(
      (item) => item.id === request.params.identityId,
    );
    if (!identity)
      return reply.status(404).send({ error: "Identity not found" });
    const headers = request.body?.headers ?? {};
    const cookies = request.body?.cookies ?? {};
    if (!Object.keys(headers).length && !Object.keys(cookies).length)
      return reply
        .status(400)
        .send({ error: "Explicit runtime credential material is required" });
    runtimeCredentials.set(identity.id, {
      headers: structuredClone(headers),
      cookies: structuredClone(cookies),
    });
    return {
      identityId: identity.id,
      available: true,
      headerNames: Object.keys(headers),
      cookieNames: Object.keys(cookies),
      persisted: false,
    };
  });
  app.post<{
    Body: {
      baselineObservationId: string;
      hypothesisId?: string | null;
      mutation: ExperimentMutation;
      targetIdentityId?: string | null;
    };
  }>("/replay/prepare", async (request, reply) => {
    if (!lastImport)
      return reply.status(409).send({ error: "Import a HAR before replay" });
    const baseline = lastImport.observations.find(
      (item) => item.id === request.body?.baselineObservationId,
    );
    if (!baseline)
      return reply
        .status(404)
        .send({ error: "Baseline observation not found" });
    if (
      request.body.hypothesisId &&
      !lastHypotheses?.some(
        (item) =>
          item.id === request.body.hypothesisId &&
          item.endpointId === baseline.endpointId,
      )
    )
      return reply
        .status(400)
        .send({ error: "Hypothesis does not belong to the baseline endpoint" });
    let reconstructed: ReconstructedRequest;
    try {
      reconstructed = reconstructRequest(
        baseline,
        request.body.mutation,
        identities,
        runtimeCredentials,
        request.body.targetIdentityId,
      );
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : String(error),
        networkRequests: 0,
      });
    }
    const scopeDecision = isRequestInScope(
      {
        method: reconstructed.method,
        url: reconstructed.url,
        body: reconstructed.body,
      },
      projectScope,
      {
        rateAvailable: projectScope
          ? requestBudget.canConsumeRequest(projectScope)
          : false,
      },
    );
    const preparedAt = new Date().toISOString();
    const preparedEvidence = ledger.append("note", {
      event: "replay_prepared",
      baselineObservationId: baseline.id,
      mutationDescription: reconstructed.mutationDescription,
      preparedAt,
    });
    const scopeEvidence = ledger.append("scope", {
      event: "replay_scope_decision",
      baselineObservationId: baseline.id,
      decision: scopeDecision,
    });
    if (!scopeDecision.allowed)
      return {
        token: null,
        baseline: reconstructed.baselinePreview,
        changedOnly: reconstructed.mutationDescription,
        preview: reconstructed.preview,
        scopeDecision,
        rateAvailable: scopeDecision.reasonCode !== "RATE_LIMIT_EXHAUSTED",
        approvalRequired: false,
        networkRequests: 0,
      };
    const token = crypto.randomUUID();
    preparedReplays.set(token, {
      baseline,
      request: reconstructed,
      mutation: structuredClone(request.body.mutation),
      hypothesisId: request.body.hypothesisId ?? null,
      preparedAt,
      evidenceIds: [preparedEvidence.id, scopeEvidence.id],
    });
    return {
      token,
      baseline: reconstructed.baselinePreview,
      changedOnly: reconstructed.mutationDescription,
      preview: reconstructed.preview,
      scopeDecision,
      rateAvailable: true,
      approvalRequired: true,
      networkRequests: 0,
    };
  });
  app.post<{ Params: { token: string } }>(
    "/replay/:token/cancel",
    async (request, reply) => {
      if (!preparedReplays.delete(request.params.token))
        return reply.status(404).send({ error: "Replay preview not found" });
      return { cancelled: true, networkRequests: 0 };
    },
  );
  app.post<{
    Params: { token: string };
    Body: { approval?: boolean };
  }>("/replay/:token/send", async (request, reply) => {
    if (request.body?.approval !== true)
      return reply.status(400).send({
        error: "Explicit approval is required",
        networkRequests: 0,
      });
    const prepared = preparedReplays.get(request.params.token);
    if (!prepared)
      return reply.status(404).send({
        error: "Replay preview not found or already used",
        networkRequests: 0,
      });
    preparedReplays.delete(request.params.token);
    if (Date.now() - Date.parse(prepared.preparedAt) > 10 * 60_000)
      return reply.status(410).send({
        error: "Replay preview expired",
        networkRequests: 0,
      });
    const scopeDecision = isRequestInScope(
      {
        method: prepared.request.method,
        url: prepared.request.url,
        body: prepared.request.body,
      },
      projectScope,
      {
        rateAvailable: projectScope
          ? requestBudget.canConsumeRequest(projectScope)
          : false,
      },
    );
    if (!scopeDecision.allowed)
      return reply.status(403).send({
        error: scopeDecision.reason,
        decision: scopeDecision,
        networkRequests: 0,
      });
    if (!projectScope || !requestBudget.consumeRequest(projectScope))
      return reply.status(429).send({
        error: "Project request budget is exhausted",
        networkRequests: 0,
      });
    const approvedAt = new Date().toISOString();
    projectScope.stopConditions.requestCount += 1;
    projectScope.rateWindowTimestamps = requestBudget.snapshot(projectScope.id);
    projectScope.updatedAt = approvedAt;
    forcePersistRequests.add(request);
    const approvalEvidence = ledger.append("note", {
      event: "replay_human_approval",
      baselineObservationId: prepared.baseline.id,
      approvedAt,
    });
    const sentEvidence = ledger.append("experiment", {
      event: "replay_request_sent",
      baselineObservationId: prepared.baseline.id,
      method: prepared.request.method,
      url: sanitizeUrl(prepared.request.url),
      approvedAt,
    });
    let replayResponse;
    try {
      replayResponse = await executeReplayRequest(prepared.request, {
        timeoutMs: options.replayTimeoutMs ?? 10_000,
        maxResponseBytes: options.maxReplayResponseBytes ?? 1_048_576,
      });
    } catch (error) {
      ledger.append("note", {
        event: "replay_failed",
        baselineObservationId: prepared.baseline.id,
        reason: error instanceof Error ? error.message : String(error),
      });
      return reply.status(502).send({
        error: error instanceof Error ? error.message : String(error),
        networkRequests: 1,
        retries: 0,
      });
    }
    const safeUrl = sanitizeUrl(prepared.request.url);
    const safeRequestHeaders = redactHeaders(prepared.request.headers);
    const safeRequestBody = redactBody(
      prepared.request.body,
      safeRequestHeaders["content-type"] ??
        safeRequestHeaders["Content-Type"] ??
        "",
    );
    const responsePayload = {
      baselineObservationId: prepared.baseline.id,
      status: replayResponse.status,
      size: replayResponse.size,
      timingMs: replayResponse.timingMs,
      truncated: replayResponse.truncated,
      redirectLocation: replayResponse.redirectLocation,
    };
    const responseEvidence = ledger.append("observation", {
      event: "replay_response_received",
      ...responsePayload,
    });
    const capturedAt = new Date().toISOString();
    const observationPayload = {
      endpointId: prepared.baseline.endpointId,
      method: prepared.request.method,
      url: safeUrl,
      requestHeaders: safeRequestHeaders,
      requestBodyShape: bodyShape(safeRequestBody),
      responseStatus: replayResponse.status,
      responseHeaders: replayResponse.headers,
      responseBodyShape: bodyShape(replayResponse.body),
      responseSize: replayResponse.size,
      capturedAt,
    };
    const resultObservation: Observation = {
      id: hashPayload(observationPayload).slice(0, 24),
      ...observationPayload,
      pathTemplate: prepared.baseline.pathTemplate,
      redacted: true,
      contentHash: hashPayload(observationPayload),
      http: {
        request: {
          httpVersion: "HTTP/1.1",
          target: `${new URL(safeUrl).pathname}${new URL(safeUrl).search}`,
          headers: safeRequestHeaders,
          cookies: {},
          query: Object.fromEntries(new URL(safeUrl).searchParams.entries()),
          body: safeRequestBody,
        },
        response: {
          httpVersion: "HTTP/1.1",
          status: replayResponse.status,
          statusText: replayResponse.statusText,
          headers: replayResponse.headers,
          body: replayResponse.body,
        },
      },
      parsedInputs: prepared.baseline.parsedInputs,
      identityId: prepared.request.targetIdentityId,
    };
    lastImport!.observations.push(resultObservation);
    changedImportRequests.add(request);
    const endpoint = lastImport!.endpoints.find(
      (item) => item.id === prepared.baseline.endpointId,
    );
    if (endpoint) {
      endpoint.observationCount += 1;
      endpoint.lastSeen = capturedAt;
      if (!endpoint.statusCodes.includes(replayResponse.status))
        endpoint.statusCodes.push(replayResponse.status);
    }
    const experimentId = hashPayload({
      baseline: prepared.baseline.id,
      result: resultObservation.id,
      approvedAt,
    }).slice(0, 20);
    const diff = compareObservations(
      experimentId,
      prepared.baseline,
      resultObservation,
    );
    const redirectDecision = replayResponse.redirectLocation
      ? evaluateRedirectTarget(
          prepared.request.method,
          replayResponse.redirectLocation,
          projectScope,
          {
            rateAvailable: requestBudget.canConsumeRequest(projectScope),
          },
        )
      : null;
    const diffEvidence = ledger.append("diff", {
      event: "replay_diff_created",
      diff,
    });
    const experiment: Experiment = {
      id: experimentId,
      endpointId: prepared.baseline.endpointId,
      baselineObservationId: prepared.baseline.id,
      resultObservationId: resultObservation.id,
      hypothesisId: prepared.hypothesisId,
      mutation: redactMutation(prepared.mutation),
      mutationDescription: prepared.request.mutationDescription,
      comparisonClassification: "controlled",
      requestDifferences: [],
      diff,
      baselineIdentityId: prepared.baseline.identityId,
      resultIdentityId: prepared.request.targetIdentityId,
      status: diff.bodyComparison === "identical" ? "same" : "different",
      conclusion: null,
      notes: null,
      evidenceIds: [
        ...prepared.evidenceIds,
        approvalEvidence.id,
        sentEvidence.id,
        responseEvidence.id,
        diffEvidence.id,
      ],
      createdAt: approvedAt,
      updatedAt: capturedAt,
      replay: {
        active: true,
        outboundUrl: safeUrl,
        outboundMethod: prepared.request.method,
        requestPreview: prepared.request.preview,
        scopeDecision,
        approvedAt,
        responseTimingMs: replayResponse.timingMs,
        responseSize: replayResponse.size,
        responseTruncated: replayResponse.truncated,
        redirectLocation: replayResponse.redirectLocation,
        redirectDecision,
      },
    };
    experiments.push(experiment);
    if (replayResponse.status >= 500 && projectScope) {
      const count = (projectScope.stopConditions.serverErrorCount ?? 0) + 1;
      projectScope.stopConditions.serverErrorCount = count;
      if (count >= 3) projectScope.stopConditions.repeatedServerErrors = true;
    }
    refreshGraph();
    return {
      experiment,
      observation: resultObservation,
      response: replayResponse,
      diff,
      redirect: replayResponse.redirectLocation
        ? {
            proposed: replayResponse.redirectLocation,
            decision: redirectDecision,
            followed: false,
            approvalRequired: true,
          }
        : null,
      networkRequests: 1,
      retries: 0,
      ledgerValid: ledger.verify(),
    };
  });
  app.get("/inventory", async (_request, reply) => {
    if (!lastImport || !lastGraph || !lastHypotheses)
      return reply
        .status(404)
        .send({ error: "No inventory yet - import a HAR first" });
    return {
      observations: lastImport.observations,
      endpoints: lastImport.endpoints,
      inputs: lastImport.inputs,
      identities,
      assets,
      trustBoundaries,
      hypotheses: lastHypotheses,
      experiments,
      graph: lastGraph,
      evidence: ledger.all(),
      scope: projectScope,
    };
  });
  app.patch<{
    Params: { observationId: string };
    Body: { identityId: string };
  }>("/observations/:observationId/identity", async (request, reply) => {
    if (!lastImport)
      return reply
        .status(409)
        .send({ error: "Import a HAR before assigning identities" });
    const observation = lastImport.observations.find(
      (item) => item.id === request.params.observationId,
    );
    const identity = identities.find(
      (item) => item.id === request.body?.identityId,
    );
    if (!observation || !identity)
      return reply
        .status(404)
        .send({ error: "Observation or identity not found" });
    for (const item of identities)
      item.associatedObservationIds = item.associatedObservationIds.filter(
        (id) => id !== observation.id,
      );
    observation.identityId = identity.id;
    identity.associatedObservationIds.push(observation.id);
    refreshGraph();
    return { observation, identity };
  });

  app.post<{
    Body: {
      label: string;
      category: AssetCategory;
      notes?: string;
      linkedEndpointIds?: string[];
      linkedObservationIds?: string[];
    };
  }>("/assets", async (request, reply) => {
    if (!lastImport)
      return reply
        .status(409)
        .send({ error: "Import a HAR before adding assets" });
    const body = request.body;
    if (!body?.label?.trim() || !ASSET_CATEGORIES.has(body.category))
      return reply
        .status(400)
        .send({ error: "Valid asset label and category required" });
    if (
      !validIds(body.linkedEndpointIds, lastImport.endpoints) ||
      !validIds(body.linkedObservationIds, lastImport.observations)
    )
      return reply.status(400).send({
        error: "Asset links must reference imported endpoints and observations",
      });
    const createdAt = new Date().toISOString();
    const asset: Asset = {
      id: hashPayload({
        kind: "asset",
        label: body.label.trim(),
        createdAt,
      }).slice(0, 20),
      label: body.label.trim(),
      category: body.category,
      notes: redactBody(body.notes, "text/plain"),
      linkedEndpointIds: unique(body.linkedEndpointIds),
      linkedObservationIds: unique(body.linkedObservationIds),
      createdAt,
      provenance: "manual",
    };
    assets.push(asset);
    refreshGraph();
    return reply.status(201).send(asset);
  });
  app.patch<{
    Params: { assetId: string };
    Body: Partial<
      Pick<
        Asset,
        | "label"
        | "category"
        | "notes"
        | "linkedEndpointIds"
        | "linkedObservationIds"
      >
    >;
  }>("/assets/:assetId", async (request, reply) => {
    const asset = assets.find((item) => item.id === request.params.assetId);
    if (!asset || !lastImport)
      return reply.status(404).send({ error: "Asset not found" });
    const body = request.body ?? {};
    if (body.category && !ASSET_CATEGORIES.has(body.category))
      return reply.status(400).send({ error: "Invalid asset category" });
    if (
      !validIds(body.linkedEndpointIds, lastImport.endpoints) ||
      !validIds(body.linkedObservationIds, lastImport.observations)
    )
      return reply.status(400).send({ error: "Invalid asset link" });
    if (body.label !== undefined) asset.label = body.label.trim();
    if (body.category !== undefined) asset.category = body.category;
    if (body.notes !== undefined)
      asset.notes = redactBody(body.notes, "text/plain");
    if (body.linkedEndpointIds !== undefined)
      asset.linkedEndpointIds = unique(body.linkedEndpointIds);
    if (body.linkedObservationIds !== undefined)
      asset.linkedObservationIds = unique(body.linkedObservationIds);
    refreshGraph();
    return asset;
  });
  app.delete<{ Params: { assetId: string } }>(
    "/assets/:assetId",
    async (request, reply) => {
      const index = assets.findIndex(
        (item) => item.id === request.params.assetId,
      );
      if (index < 0)
        return reply.status(404).send({ error: "Asset not found" });
      assets.splice(index, 1);
      for (const hypothesis of lastHypotheses ?? [])
        hypothesis.assetIds = hypothesis.assetIds.filter(
          (id) => id !== request.params.assetId,
        );
      refreshGraph();
      return reply.status(204).send();
    },
  );

  app.post<{
    Body: {
      label: string;
      type: TrustBoundaryType;
      notes?: string;
      sourceRef: string;
      destinationRef: string;
    };
  }>("/trust-boundaries", async (request, reply) => {
    const body = request.body;
    if (
      !body?.label?.trim() ||
      !BOUNDARY_TYPES.has(body.type) ||
      !body.sourceRef?.trim() ||
      !body.destinationRef?.trim()
    )
      return reply.status(400).send({
        error: "Valid boundary label, type, source, and destination required",
      });
    const createdAt = new Date().toISOString();
    const boundary: TrustBoundary = {
      id: hashPayload({
        kind: "boundary",
        label: body.label.trim(),
        createdAt,
      }).slice(0, 20),
      label: body.label.trim(),
      type: body.type,
      notes: redactBody(body.notes, "text/plain"),
      sourceRef: body.sourceRef.trim(),
      destinationRef: body.destinationRef.trim(),
      createdAt,
      provenance: "manual",
    };
    trustBoundaries.push(boundary);
    refreshGraph();
    return reply.status(201).send(boundary);
  });
  app.patch<{
    Params: { boundaryId: string };
    Body: Partial<
      Pick<
        TrustBoundary,
        "label" | "type" | "notes" | "sourceRef" | "destinationRef"
      >
    >;
  }>("/trust-boundaries/:boundaryId", async (request, reply) => {
    const boundary = trustBoundaries.find(
      (item) => item.id === request.params.boundaryId,
    );
    if (!boundary)
      return reply.status(404).send({ error: "Trust boundary not found" });
    const body = request.body ?? {};
    if (body.type && !BOUNDARY_TYPES.has(body.type))
      return reply.status(400).send({ error: "Invalid trust boundary type" });
    if (body.label !== undefined) boundary.label = body.label.trim();
    if (body.type !== undefined) boundary.type = body.type;
    if (body.notes !== undefined)
      boundary.notes = redactBody(body.notes, "text/plain");
    if (body.sourceRef !== undefined)
      boundary.sourceRef = body.sourceRef.trim();
    if (body.destinationRef !== undefined)
      boundary.destinationRef = body.destinationRef.trim();
    refreshGraph();
    return boundary;
  });
  app.delete<{ Params: { boundaryId: string } }>(
    "/trust-boundaries/:boundaryId",
    async (request, reply) => {
      const index = trustBoundaries.findIndex(
        (item) => item.id === request.params.boundaryId,
      );
      if (index < 0)
        return reply.status(404).send({ error: "Trust boundary not found" });
      trustBoundaries.splice(index, 1);
      for (const hypothesis of lastHypotheses ?? [])
        hypothesis.trustBoundaryIds = hypothesis.trustBoundaryIds.filter(
          (id) => id !== request.params.boundaryId,
        );
      refreshGraph();
      return reply.status(204).send();
    },
  );

  app.patch<{
    Params: { hypothesisId: string };
    Body: {
      status?: HypothesisStatus;
      observationIds?: string[];
      experimentIds?: string[];
      assetIds?: string[];
      trustBoundaryIds?: string[];
      evidenceIds?: string[];
      notes?: string;
    };
  }>("/hypotheses/:hypothesisId", async (request, reply) => {
    const hypothesis = lastHypotheses?.find(
      (item) => item.id === request.params.hypothesisId,
    );
    if (!hypothesis || !lastImport)
      return reply.status(404).send({ error: "Hypothesis not found" });
    const body = request.body ?? {};
    if (body.status && !HYPOTHESIS_STATUSES.has(body.status))
      return reply.status(400).send({ error: "Invalid hypothesis status" });
    if (
      !validIds(body.observationIds, lastImport.observations) ||
      !validIds(body.experimentIds, experiments) ||
      !validIds(body.assetIds, assets) ||
      !validIds(body.trustBoundaryIds, trustBoundaries) ||
      !validIds(body.evidenceIds, ledger.all())
    )
      return reply.status(400).send({ error: "Invalid hypothesis reference" });
    if (body.status !== undefined) hypothesis.status = body.status;
    if (body.observationIds !== undefined)
      hypothesis.observationIds = unique(body.observationIds);
    if (body.experimentIds !== undefined)
      hypothesis.experimentIds = unique(body.experimentIds);
    if (body.assetIds !== undefined)
      hypothesis.assetIds = unique(body.assetIds);
    if (body.trustBoundaryIds !== undefined)
      hypothesis.trustBoundaryIds = unique(body.trustBoundaryIds);
    if (body.evidenceIds !== undefined)
      hypothesis.evidenceIds = unique(body.evidenceIds);
    if (body.notes !== undefined)
      hypothesis.notes = redactBody(body.notes, "text/plain");
    const evidence = ledger.append("note", {
      event: "hypothesis_updated",
      hypothesisId: hypothesis.id,
      status: hypothesis.status,
    });
    if (!hypothesis.evidenceIds.includes(evidence.id))
      hypothesis.evidenceIds.push(evidence.id);
    refreshGraph();
    return { hypothesis, evidence, ledgerValid: ledger.verify() };
  });

  app.get<{
    Querystring: { status?: string; endpointId?: string; identityId?: string };
  }>("/experiments", async (request) => {
    const { status, endpointId, identityId } = request.query;
    return experiments.filter(
      (item) =>
        (!status || item.status === status) &&
        (!endpointId || item.endpointId === endpointId) &&
        (!identityId ||
          item.baselineIdentityId === identityId ||
          item.resultIdentityId === identityId),
    );
  });
  app.get<{ Params: { experimentId: string } }>(
    "/experiments/:experimentId",
    async (request, reply) => {
      return (
        experiments.find((item) => item.id === request.params.experimentId) ??
        reply.status(404).send({ error: "Experiment not found" })
      );
    },
  );
  app.patch<{
    Params: { experimentId: string };
    Body: {
      status?: ExperimentStatus;
      conclusion?: TesterConclusion | null;
      notes?: string;
    };
  }>("/experiments/:experimentId", async (request, reply) => {
    const experiment = experiments.find(
      (item) => item.id === request.params.experimentId,
    );
    if (!experiment)
      return reply.status(404).send({ error: "Experiment not found" });
    const body = request.body ?? {};
    if (body.status !== undefined && !EXPERIMENT_STATUSES.has(body.status))
      return reply.status(400).send({ error: "Invalid experiment status" });
    if (
      body.conclusion !== undefined &&
      body.conclusion !== null &&
      !TESTER_CONCLUSIONS.has(body.conclusion)
    )
      return reply.status(400).send({ error: "Invalid tester conclusion" });
    if (
      body.status === undefined &&
      body.conclusion === undefined &&
      body.notes === undefined
    )
      return reply
        .status(400)
        .send({ error: "Status, conclusion, or notes required" });
    const evidence = [];
    if (body.status !== undefined && body.status !== experiment.status) {
      experiment.status = body.status;
      evidence.push(
        ledger.append("note", {
          event: lifecycleEvent({ status: body.status }),
          experimentId: experiment.id,
          status: body.status,
        }),
      );
    }
    if (
      body.conclusion !== undefined &&
      body.conclusion !== experiment.conclusion
    ) {
      experiment.conclusion = body.conclusion;
      evidence.push(
        ledger.append("note", {
          event: "conclusion_changed",
          experimentId: experiment.id,
          conclusion: body.conclusion,
        }),
      );
    }
    if (body.notes !== undefined) {
      experiment.notes = redactBody(body.notes, "text/plain");
      evidence.push(
        ledger.append("note", {
          event: "notes_updated",
          experimentId: experiment.id,
        }),
      );
    }
    experiment.updatedAt = new Date().toISOString();
    experiment.evidenceIds.push(...evidence.map((item) => item.id));
    return { experiment, evidence, ledgerValid: ledger.verify() };
  });

  app.post<{
    Body: {
      endpointId: string;
      hypothesisId: string;
      baselineObservationId: string;
      resultObservationId: string;
      inputId?: string;
      mutation: ExperimentMutation;
      notes?: string;
    };
  }>("/experiments", async (request, reply) => {
    if (!lastImport || !lastHypotheses)
      return reply
        .status(409)
        .send({ error: "Import a HAR before creating an experiment" });
    const body = request.body;
    if (
      !body ||
      !body.endpointId ||
      !body.hypothesisId ||
      !body.baselineObservationId ||
      !body.resultObservationId ||
      !body.mutation
    ) {
      return reply.status(400).send({
        error:
          "endpoint, hypothesis, baseline, result, and mutation are required",
      });
    }
    if (body.baselineObservationId === body.resultObservationId) {
      return reply
        .status(400)
        .send({ error: "Baseline and result observations must be different" });
    }
    const baseline = lastImport.observations.find(
      (item) => item.id === body.baselineObservationId,
    );
    const result = lastImport.observations.find(
      (item) => item.id === body.resultObservationId,
    );
    if (
      !baseline ||
      !result ||
      baseline.endpointId !== body.endpointId ||
      result.endpointId !== body.endpointId
    ) {
      return reply.status(400).send({
        error:
          "Baseline and result must be observations of the selected endpoint",
      });
    }
    const hypothesis = lastHypotheses.find(
      (item) =>
        item.id === body.hypothesisId && item.endpointId === body.endpointId,
    );
    if (!hypothesis)
      return reply
        .status(400)
        .send({ error: "Hypothesis does not belong to the selected endpoint" });

    let mutationKind;
    try {
      mutationKind = assertOneVariable(body.mutation);
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : String(error),
      });
    }
    const input = body.inputId
      ? lastImport.inputs.find(
          (item) =>
            item.id === body.inputId && item.endpointId === body.endpointId,
        )
      : undefined;
    if (
      mutationKind !== "identity" &&
      (!input || !mutationMatchesInput(mutationKind, body.mutation, input))
    ) {
      return reply.status(400).send({
        error: "Mutation must match an input on the selected endpoint",
      });
    }
    const safeMutation =
      input?.sensitivity === "sensitive"
        ? redactMutation(body.mutation)
        : body.mutation;
    const createdAt = new Date().toISOString();
    const experimentId = hashPayload({
      baseline: baseline.id,
      result: result.id,
      hypothesis: hypothesis.id,
      mutation: safeMutation,
      createdAt,
    }).slice(0, 24);
    const diff = compareObservations(experimentId, baseline, result);
    const requestDifferences = compareSafeRequests(
      baseline,
      result,
      mutationKind,
    );
    const comparisonClassification = requestDifferences.length
      ? "observational"
      : "controlled";
    const experiment: Experiment = {
      id: experimentId,
      endpointId: body.endpointId,
      baselineObservationId: baseline.id,
      hypothesisId: hypothesis.id,
      mutation: safeMutation,
      mutationDescription: describeMutation(safeMutation),
      comparisonClassification,
      requestDifferences,
      diff,
      baselineIdentityId: baseline.identityId,
      resultIdentityId: result.identityId,
      status: "investigating",
      resultObservationId: result.id,
      conclusion: null,
      notes: redactBody(body.notes?.trim(), "text/plain"),
      evidenceIds: [],
      createdAt,
      updatedAt: createdAt,
    };
    const experimentEvidence = ledger.append("experiment", {
      ...experiment,
      evidenceIds: [],
    });
    const diffEvidence = ledger.append("diff", diff);
    experiment.evidenceIds.push(experimentEvidence.id, diffEvidence.id);
    experiments.push(experiment);
    refreshGraph();
    return reply.status(201).send({
      experiment,
      diff,
      evidence: [experimentEvidence, diffEvidence],
      ledgerValid: ledger.verify(),
    });
  });
  return app;
}

function mutationMatchesInput(
  kind: string,
  mutation: ExperimentMutation,
  input: InputDescriptor,
): boolean {
  if (kind === "pathParam")
    return input.location === "path" && mutation.pathParam?.name === input.name;
  if (kind === "queryParam")
    return (
      input.location === "query" && mutation.queryParam?.name === input.name
    );
  if (kind === "header")
    return (
      ["header", "cookie"].includes(input.location) &&
      mutation.header?.name === input.name
    );
  if (kind === "bodyField")
    return (
      ["body-json", "body-form"].includes(input.location) &&
      mutation.bodyField?.path === input.name
    );
  return kind === "identity";
}

function redactMutation(mutation: ExperimentMutation): ExperimentMutation {
  if (mutation.queryParam)
    return {
      queryParam: { ...mutation.queryParam, from: REDACTED, to: REDACTED },
    };
  if (mutation.header)
    return { header: { ...mutation.header, from: REDACTED, to: REDACTED } };
  if (mutation.bodyField)
    return {
      bodyField: { ...mutation.bodyField, from: REDACTED, to: REDACTED },
    };
  if (mutation.pathParam)
    return {
      pathParam: { ...mutation.pathParam, from: REDACTED, to: REDACTED },
    };
  return mutation;
}

function lifecycleEvent(changes: Record<string, unknown>): string {
  if (changes.status === "candidate_finding")
    return "candidate_finding_declared";
  if (changes.status === "closed") return "experiment_closed";
  if (changes.status) return "status_changed";
  if (Object.hasOwn(changes, "conclusion")) return "conclusion_changed";
  return "notes_updated";
}

function unique(values: string[] | undefined): string[] {
  return [...new Set(values ?? [])].sort();
}
function validIds(
  values: string[] | undefined,
  records: readonly { id: string }[],
): boolean {
  return (
    values === undefined ||
    values.every((id) => records.some((item) => item.id === id))
  );
}

function compareSafeRequests(
  baseline: Observation,
  result: Observation,
  mutationKind: string,
): string[] {
  const differences: string[] = [];
  const left = baseline.http.request;
  const right = result.http.request;
  if (baseline.method !== result.method) differences.push("method");
  const leftUrl = new URL(left.target, "https://surfacetrace.invalid");
  const rightUrl = new URL(right.target, "https://surfacetrace.invalid");
  if (leftUrl.pathname !== rightUrl.pathname && mutationKind !== "pathParam")
    differences.push("path");
  const queryNames = new Set([
    ...leftUrl.searchParams.keys(),
    ...rightUrl.searchParams.keys(),
  ]);
  for (const name of queryNames) {
    if (
      leftUrl.searchParams.get(name) !== rightUrl.searchParams.get(name) &&
      !(mutationKind === "queryParam")
    )
      differences.push(`query.${name}`);
  }
  const headerNames = new Set([
    ...Object.keys(left.headers),
    ...Object.keys(right.headers),
  ]);
  for (const name of headerNames) {
    const lower = name.toLowerCase();
    const identityHeader =
      ["authorization", "cookie"].includes(lower) &&
      mutationKind === "identity";
    const declaredHeader = mutationKind === "header";
    if (
      left.headers[name] !== right.headers[name] &&
      !identityHeader &&
      !declaredHeader
    )
      differences.push(`header.${lower}`);
  }
  if (left.body !== right.body && mutationKind !== "bodyField")
    differences.push("body");
  if (baseline.identityId !== result.identityId && mutationKind !== "identity")
    differences.push("identity");
  return differences;
}
