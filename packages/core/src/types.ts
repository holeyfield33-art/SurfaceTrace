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
  | "body-json"
  | "body-form";

export type IdentityRole =
  | "anonymous"
  | "user"
  | "admin"
  | "service"
  | "unknown";

export type AssetSensitivity = "low" | "medium" | "high" | "critical";
export type Provenance = "observed" | "manual" | "inferred";
export type AssetCategory =
  | "pii"
  | "account_data"
  | "payment_data"
  | "credentials_secrets"
  | "documents_files"
  | "administrative_function"
  | "internal_service_data"
  | "custom";
export type TrustBoundaryType =
  | "browser_api"
  | "public_authenticated"
  | "user_privileged"
  | "application_third_party"
  | "application_internal_service"
  | "custom";
export type HypothesisStatus =
  | "open"
  | "investigating"
  | "supported"
  | "not_supported"
  | "needs_more_evidence"
  | "closed";

export type ExperimentStatus =
  | "open"
  | "investigating"
  | "same"
  | "different"
  | "needs_review"
  | "candidate_finding"
  | "closed";

export type TesterConclusion =
  | "no_meaningful_difference"
  | "expected_difference"
  | "unexpected_difference"
  | "needs_more_testing"
  | "potential_security_issue"
  | "not_reproducible";

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

export interface ProjectScope {
  id: string;
  projectId: string;
  active: boolean;
  allowedHosts: string[];
  allowedProtocols: Array<"http" | "https">;
  allowedPorts: number[];
  allowedPathPrefixes: string[];
  excludedPathPrefixes: string[];
  allowedMethods: HttpMethod[];
  maxRequestsPerMinute: number;
  rateWindowTimestamps?: number[];
  stopConditions: ScopeStopConditions;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScopeStopConditions {
  manualStop: boolean;
  maxRequestCount: number | null;
  requestCount: number;
  repeatedServerErrors: boolean;
  serverErrorCount?: number;
  authenticationLost: boolean;
  customNote: string | null;
}

export interface CandidateRequest {
  method: string;
  url: string;
  body?: unknown;
}

export type ScopeReasonCode =
  | "IN_SCOPE"
  | "NO_ACTIVE_SCOPE"
  | "MALFORMED_URL"
  | "USERINFO_NOT_ALLOWED"
  | "PROTOCOL_NOT_ALLOWED"
  | "HOST_NOT_ALLOWED"
  | "PORT_NOT_ALLOWED"
  | "PATH_NOT_ALLOWED"
  | "PATH_EXCLUDED"
  | "METHOD_NOT_ALLOWED"
  | "MANUAL_STOP_ACTIVE"
  | "MAX_REQUEST_COUNT_REACHED"
  | "REPEATED_SERVER_ERRORS"
  | "AUTHENTICATION_LOST"
  | "RATE_LIMIT_EXHAUSTED";

export interface ScopeDecision {
  allowed: boolean;
  reasonCode: ScopeReasonCode;
  reason: string;
  matchedRule: string | null;
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
  sensitivity: "normal" | "sensitive";
  observedCount: number;
  appearsRequired: boolean | null;
}

export interface IdentityContext {
  id: string;
  label: string;
  role: IdentityRole;
  notes: string | null;
  associatedObservationIds: string[];
}

export interface Asset {
  id: string;
  label: string;
  category: AssetCategory;
  notes: string | null;
  linkedEndpointIds: string[];
  linkedObservationIds: string[];
  createdAt: string;
  provenance: "manual";
}

export interface TrustBoundary {
  id: string;
  label: string;
  type: TrustBoundaryType;
  notes: string | null;
  sourceRef: string;
  destinationRef: string;
  createdAt: string;
  provenance: "manual";
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
  http: SafeHttpTransaction;
  parsedInputs: ObservationInput[];
  identityId: string | null;
}

export interface SafeHttpTransaction {
  request: {
    httpVersion: string;
    target: string;
    headers: Record<string, string>;
    cookies: Record<string, string>;
    query: Record<string, string>;
    body: string | null;
  };
  response: {
    httpVersion: string;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string | null;
  };
}

export interface ObservationInput {
  name: string;
  location: InputLocation;
  type: string;
  sensitive: boolean;
}

export interface Hypothesis {
  id: string;
  endpointId: string;
  question: string;
  signal: string;
  strideCategory: string | null;
  priority: number;
  status: HypothesisStatus;
  observationIds: string[];
  experimentIds: string[];
  assetIds: string[];
  trustBoundaryIds: string[];
  evidenceIds: string[];
  notes: string | null;
  provenance: "inferred";
  reasoning?: HypothesisReasoning | null;
}

export interface HypothesisReasoning {
  category: "ssrf" | "redirect";
  inputId: string;
  inputName: string;
  inputLocation: InputLocation;
  signalType: "input_name" | "absolute_url" | "endpoint_context";
  signalReason: string;
  signalStrength: "strong" | "moderate" | "contextual";
  valueClass: "absolute URL" | null;
  followUpQuestion: string | null;
  teachingContext: string;
  nextSteps: string[];
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
  endpointId: string;
  baselineObservationId: string;
  hypothesisId: string | null;
  mutation: ExperimentMutation;
  mutationDescription: string;
  comparisonClassification: "controlled" | "observational";
  requestDifferences: string[];
  diff: DiffCard;
  baselineIdentityId: string | null;
  resultIdentityId: string | null;
  status: ExperimentStatus;
  resultObservationId: string | null;
  conclusion: TesterConclusion | null;
  notes: string | null;
  evidenceIds: string[];
  createdAt: string;
  updatedAt: string;
  replay?: {
    active: true;
    outboundUrl: string;
    outboundMethod: string;
    requestPreview: string;
    scopeDecision: ScopeDecision;
    approvedAt: string;
    responseTimingMs: number;
    responseSize: number;
    responseTruncated: boolean;
    redirectLocation: string | null;
    redirectDecision: ScopeDecision | null;
  };
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
  bodyChanges: BodyChange[];
  bodyChangeCount: number;
  bodyComparison: "identical" | "different" | "non_json";
  truncated: boolean;
  truncationReason: "max_depth" | "max_nodes" | "max_diff_records" | null;
  summary: string;
  confidence: "single" | "reproduced";
}

export type BodyChangeType =
  | "added"
  | "removed"
  | "value_changed"
  | "type_changed"
  | "array_length_changed";
export interface BodyChange {
  path: string;
  changeType: BodyChangeType;
  before: unknown;
  after: unknown;
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
  provenance: Provenance;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: "observed" | "inferred" | "boundary" | "hypothesis" | "experiment";
  label?: string;
}
