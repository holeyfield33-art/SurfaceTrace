import type {
  Asset,
  Endpoint,
  Experiment,
  GraphEdge,
  GraphNode,
  Hypothesis,
  IdentityContext,
  InputDescriptor,
  Observation,
  TrustBoundary,
} from "../types.js";

export interface GraphBuildInput {
  endpoints: Endpoint[];
  inputs: InputDescriptor[];
  observations: Observation[];
  identities?: IdentityContext[];
  assets?: Asset[];
  trustBoundaries?: TrustBoundary[];
  hypotheses?: Hypothesis[];
  experiments?: Experiment[];
}
export interface GraphBuildResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function buildGraph(input: GraphBuildInput): GraphBuildResult {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  for (const endpoint of input.endpoints)
    nodes.push({
      id: endpoint.id,
      kind: "endpoint",
      label: `${endpoint.method} ${endpoint.pathTemplate}`,
      provenance: "observed",
      data: {
        method: endpoint.method,
        host: endpoint.host,
        statusCodes: endpoint.statusCodes,
        observationCount: endpoint.observationCount,
      },
    });
  for (const descriptor of input.inputs) {
    nodes.push({
      id: descriptor.id,
      kind: "input",
      label: `${descriptor.location}.${descriptor.name}`,
      provenance: "observed",
      data: {
        location: descriptor.location,
        endpointId: descriptor.endpointId,
      },
    });
    edges.push(
      edge(
        `endpoint-input-${descriptor.id}`,
        descriptor.endpointId,
        descriptor.id,
        "observed",
        "accepts",
      ),
    );
  }
  for (const identity of input.identities ?? []) {
    const endpointIds = new Set(
      input.observations
        .filter((item) => item.identityId === identity.id)
        .map((item) => item.endpointId),
    );
    if (!endpointIds.size) continue;
    nodes.push({
      id: identity.id,
      kind: "identity",
      label: identity.label,
      provenance: "manual",
      data: { role: identity.role },
    });
    for (const endpointId of [...endpointIds].sort())
      edges.push(
        edge(
          `identity-${identity.id}-${endpointId}`,
          identity.id,
          endpointId,
          "observed",
          "observed as",
        ),
      );
  }
  for (const asset of input.assets ?? []) {
    nodes.push({
      id: asset.id,
      kind: "asset",
      label: asset.label,
      provenance: "manual",
      data: { category: asset.category },
    });
    for (const endpointId of [...asset.linkedEndpointIds].sort())
      edges.push(
        edge(
          `endpoint-asset-${endpointId}-${asset.id}`,
          endpointId,
          asset.id,
          "boundary",
          "handles",
        ),
      );
  }
  for (const boundary of input.trustBoundaries ?? []) {
    nodes.push({
      id: boundary.id,
      kind: "trust_boundary",
      label: boundary.label,
      provenance: "manual",
      data: { type: boundary.type },
    });
    edges.push(
      edge(
        `boundary-source-${boundary.id}`,
        boundary.sourceRef,
        boundary.id,
        "boundary",
        "crosses",
      ),
    );
    edges.push(
      edge(
        `boundary-destination-${boundary.id}`,
        boundary.id,
        boundary.destinationRef,
        "boundary",
        "to",
      ),
    );
  }
  for (const hypothesis of input.hypotheses ?? []) {
    nodes.push({
      id: hypothesis.id,
      kind: "hypothesis",
      label: hypothesis.question,
      provenance: "inferred",
      data: { status: hypothesis.status, priority: hypothesis.priority },
    });
    edges.push(
      edge(
        `hypothesis-${hypothesis.id}`,
        hypothesis.id,
        hypothesis.endpointId,
        "hypothesis",
        "questions",
      ),
    );
    if (hypothesis.reasoning?.inputId) {
      edges.push(
        edge(
          `hypothesis-input-${hypothesis.id}`,
          hypothesis.id,
          hypothesis.reasoning.inputId,
          "hypothesis",
          "reviews input",
        ),
      );
    }
  }
  for (const experiment of input.experiments ?? []) {
    nodes.push({
      id: experiment.id,
      kind: "experiment",
      label: experiment.mutationDescription,
      provenance: "manual",
      data: { status: experiment.status },
    });
    if (experiment.hypothesisId)
      edges.push(
        edge(
          `experiment-${experiment.id}`,
          experiment.id,
          experiment.hypothesisId,
          "experiment",
          "tests",
        ),
      );
  }
  return { nodes, edges };
}

function edge(
  id: string,
  source: string,
  target: string,
  kind: GraphEdge["kind"],
  label: string,
): GraphEdge {
  return { id, source, target, kind, label };
}
