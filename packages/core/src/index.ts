export * from "./types.js";

export { parseHarJson, importHar } from "./har/importHar.js";
export type { ImportResult } from "./har/importHar.js";
export {
  toPathTemplate,
  extractPathParams,
  segmentToPlaceholder,
} from "./har/pathTemplate.js";
export {
  redactHeaders,
  redactQueryParams,
  bodyShape,
  isSensitiveHeader,
  isSensitiveQueryParam,
  sanitizeUrl,
  redactBody,
  REDACTED,
} from "./har/redact.js";

export { buildGraph } from "./graph/buildGraph.js";
export type { GraphBuildInput, GraphBuildResult } from "./graph/buildGraph.js";

export { generateHypotheses } from "./threat/hypotheses.js";

export {
  assertOneVariable,
  describeMutation,
} from "./experiment/oneVariable.js";
export type { MutationKind } from "./experiment/oneVariable.js";

export { compareObservations } from "./diff/compare.js";
export type { DeepDiffLimits } from "./diff/compare.js";

export { canonicalize, sha256, hashPayload } from "./evidence/hash.js";
export { EvidenceLedger } from "./evidence/ledger.js";
export {
  buildEvidenceCoverage,
  type EvidenceCoverageInput,
  type EvidenceCoverageReport,
} from "./evidenceCoverage.js";
export {
  isRequestInScope,
  evaluateRedirectTarget,
  RequestBudget,
} from "./scope/scope.js";
export type { ScopeEvaluationContext } from "./scope/scope.js";
