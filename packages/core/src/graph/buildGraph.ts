import type {
  Endpoint,
  GraphEdge,
  GraphNode,
  InputDescriptor,
  Observation,
} from "../types.js";

export interface GraphBuildInput {
  endpoints: Endpoint[];
  inputs: InputDescriptor[];
  observations: Observation[];
}

export interface GraphBuildResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function buildGraph(input: GraphBuildInput): GraphBuildResult {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  for (const ep of input.endpoints) {
    nodes.push({
      id: ep.id,
      kind: "endpoint",
      label: `${ep.method} ${ep.pathTemplate}`,
      data: {
        method: ep.method,
        host: ep.host,
        pathTemplate: ep.pathTemplate,
        statusCodes: ep.statusCodes,
        observationCount: ep.observationCount,
        requiresAuth: ep.requiresAuth,
      },
    });
  }

  for (const inp of input.inputs) {
    nodes.push({
      id: inp.id,
      kind: "input",
      label: `${inp.location}.${inp.name}`,
      data: {
        location: inp.location,
        name: inp.name,
        endpointId: inp.endpointId,
      },
    });
    edges.push({
      id: `e-${inp.id}-${inp.endpointId}`,
      source: inp.id,
      target: inp.endpointId,
      kind: "observed",
      label: "feeds",
    });
  }

  return { nodes, edges };
}
