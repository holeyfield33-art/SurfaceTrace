/**
 * Core domain types for SurfaceTrace.
 * Pure data shapes — no I/O, no network, no UI.
 */

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

export type InputLocation =
  | "query"
  | "path"
  | "header"
  | "cookie"
  | "body"
  | "form";

export type IdentityRole = "anonymous" | "user" | "admin" | "service" | "unknown";

export type AssetSensitivity = "low" | "medium" | "high" | "critical";

export type ExperimentStatus =
  | "planned"
  | "sent"
  | "same"
  | "different"
  | "needs_review"
  | "error";

export type NodeKind =
  | "endpoint"
  | "input"
  | "identity"
  | "asset"
  | "trust_boundary"
  | "observation"
  | "hypothesis"
  | "experiment"
  | "finding";

export interface ScopedTarget {
  id: string;
  name: string;
  authorizationConfirmed: boolean;
  allowedHosts: string[];
  allowedPathPrefixes: string[];
  excludedPathPrefixes: string[];
  testRoles: IdentityRole[];
  rateLimitPerMinute: number;
  safeMethodsOnly: boolean;
  stopConditions: string[];
  createdAt: string;
}

export interface Endpoint {
  id: string;
  method: HttpMethod;
  host: string;
  pathTemplate: string;
  firstSeen: string;
  lastSeen: string;
  statusCodes: number[];
  requiresAuth: boolean | null;
  observationCount: number;
}

export interface InputDescriptor {
  id: string;
  endpointId: string;
  name: string;
  location: InputLocation;
  sampleTypes: string[];
  appearsRequired: boolean | null;
}

export interface IdentityContext {
  id: string;
  role: IdentityRole;
  sessionHint: string | null;
  authMechanism: string | null;
}

export interface Asset {
  id: string;
  name: string;
  sensitivity: AssetSensitivity;
  fieldHints: string[];
  relatedEndpointIds: string[];
}

export interface TrustBoundary {
  id: string;
  label: string;
  from: string;
  to: string;
  riskNotes: string | null;
}

export interface Observation {
  id: string;
  endpointId: string;
  method: HttpMethod;
  url: string;
  pathTemplate: string;
  requestHeaders: Record<string, string>;
  requestBodyShape: string | null;
  responseStatus: number;
  responseHeaders: Record<string, string>;
  responseBodyShape: string | null;
  responseSize: number;
  capturedAt: string;
  redacted: boolean;
  contentHash: string;
}

export interface Hypothesis {
  id: string;
  endpointId: string;
  question: string;
  signal: string;
  strideCategory: string | null;
  priority: number;
  status: "open" | "in_progress" | "resolved" | "wont_fix";
}

export interface ExperimentMutation {
  /** Exactly one field may be set as the changed variable. */
  pathParam?: { name: string; from: string; to: string };
  queryParam?: { name: string; from: string | null; to: string | null };
  header?: { name: string; from: string | null; to: string | null };
  bodyField?: { path: string; from: unknown; to: unknown };
  identity?: { fromRole: IdentityRole; toRole: IdentityRole };
}

export interface Experiment {
  id: string;
  baselineObservationId: string;
  hypothesisId: string | null;
  mutation: ExperimentMutation;
  status: ExperimentStatus;
  resultObservationId: string | null;
  notes: string | null;
  createdAt: string;
}

export interface DiffCard {
  experimentId: string;
  statusChanged: boolean;
  statusFrom: number;
  statusTo: number;
  lengthDelta: number;
  headerChanges: string[];
  jsonKeysAdded: string[];
  jsonKeysRemoved: string[];
  summary: string;
  confidence: "single" | "reproduced";
}

export interface EvidenceRecord {
  id: string;
  prevHash: string | null;
  contentHash: string;
  kind: "observation" | "experiment" | "diff" | "note" | "scope";
  payload: unknown;
  createdAt: string;
}

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  data: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: "observed" | "inferred" | "boundary" | "hypothesis" | "experiment";
  label?: string;
}
