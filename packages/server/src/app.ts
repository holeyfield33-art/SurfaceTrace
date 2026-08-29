import cors from "@fastify/cors";
import Fastify from "fastify";
import {
  EvidenceLedger,
  REDACTED,
  assertOneVariable,
  buildGraph,
  compareObservations,
  describeMutation,
  generateHypotheses,
  hashPayload,
  importHar,
  parseHarJson,
  redactBody,
} from "@surfacetrace/core";
import type {
  Experiment,
  ExperimentMutation,
  ExperimentStatus,
  IdentityContext,
  InputDescriptor,
  Observation,
  TesterConclusion,
} from "@surfacetrace/core";

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

export interface AppOptions {
  maxBodyBytes?: number;
  maxHarEntries?: number;
  allowedOrigins?: string[];
  logger?: boolean;
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
  const ledger = new EvidenceLedger();
  const experiments: Experiment[] = [];
  let lastImport: ReturnType<typeof importHar> | null = null;
  let lastGraph: ReturnType<typeof buildGraph> | null = null;
  let lastHypotheses: ReturnType<typeof generateHypotheses> | null = null;
  const identities: IdentityContext[] = [
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
  }));
  app.post<{ Body: { har: string } }>("/import/har", async (request, reply) => {
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
    const graph = buildGraph(result);
    const hypotheses = generateHypotheses(result.endpoints, result.inputs);
    lastImport = result;
    lastGraph = graph;
    lastHypotheses = hypotheses;
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
      graph: { nodes: graph.nodes.length, edges: graph.edges.length },
      evidenceTip: ledger.tipHash(),
    };
  });

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
      hypotheses: lastHypotheses,
      experiments,
      graph: lastGraph,
      evidence: ledger.all(),
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
    return { observation, identity };
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
