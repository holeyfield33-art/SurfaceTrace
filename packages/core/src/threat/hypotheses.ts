import type { Endpoint, Hypothesis, InputDescriptor } from "../types.js";
import { hashPayload } from "../evidence/hash.js";

/**
 * Defensive test questions — never exploit payloads.
 * Grounded in common OWASP WSTG review themes.
 */

interface SignalRule {
  match: (ep: Endpoint, inputs: InputDescriptor[]) => boolean;
  question: (ep: Endpoint) => string;
  signal: string;
  stride: string;
  basePriority: number;
}

const RULES: SignalRule[] = [
  {
    match: (_ep, inputs) =>
      inputs.some((i) => i.location === "path" || /id$/i.test(i.name)),
    question: (ep) =>
      `Does the server enforce ownership and role authorization for objects accessed via ${ep.method} ${ep.pathTemplate}?`,
    signal: "object-id-in-path-or-input",
    stride: "Elevation of Privilege",
    basePriority: 7,
  },
  {
    match: (ep) => ["POST", "PUT", "PATCH", "DELETE"].includes(ep.method),
    question: (ep) =>
      `Are CSRF / session / origin protections appropriate for state-changing ${ep.method} ${ep.pathTemplate}?`,
    signal: "state-changing-method",
    stride: "Tampering",
    basePriority: 6,
  },
  {
    match: (ep) =>
      ep.pathTemplate.toLowerCase().includes("admin") ||
      ep.pathTemplate.toLowerCase().includes("internal"),
    question: (ep) =>
      `Is ${ep.method} ${ep.pathTemplate} correctly restricted to authorized admin/internal roles?`,
    signal: "admin-or-internal-route",
    stride: "Elevation of Privilege",
    basePriority: 8,
  },
  {
    match: (_ep, inputs) =>
      inputs.some((i) => /redirect|callback|return|next|url/i.test(i.name)),
    question: (ep) =>
      `Is any user-controlled redirect/callback on ${ep.method} ${ep.pathTemplate} constrained to approved destinations?`,
    signal: "user-controlled-redirect",
    stride: "Spoofing",
    basePriority: 7,
  },
  {
    match: (ep) => /upload|download|file|attachment/i.test(ep.pathTemplate),
    question: (ep) =>
      `Are type, size, storage, and access rules enforced server-side for file handling on ${ep.method} ${ep.pathTemplate}?`,
    signal: "file-handling",
    stride: "Tampering",
    basePriority: 7,
  },
  {
    match: (ep) => ep.statusCodes.some((c) => c >= 500),
    question: (ep) =>
      `Do error responses from ${ep.method} ${ep.pathTemplate} expose internals, identifiers, or sensitive data?`,
    signal: "server-error-observed",
    stride: "Information Disclosure",
    basePriority: 5,
  },
];

export function generateHypotheses(
  endpoints: Endpoint[],
  inputs: InputDescriptor[],
): Hypothesis[] {
  const results: Hypothesis[] = [];

  for (const ep of endpoints) {
    const epInputs = inputs.filter((i) => i.endpointId === ep.id);
    for (const rule of RULES) {
      if (!rule.match(ep, epInputs)) continue;
      const question = rule.question(ep);
      const id = hashPayload({ ep: ep.id, signal: rule.signal }).slice(0, 16);
      results.push({
        id,
        endpointId: ep.id,
        question,
        signal: rule.signal,
        strideCategory: rule.stride,
        priority: rule.basePriority,
        status: "open",
        observationIds: [],
        experimentIds: [],
        assetIds: [],
        trustBoundaryIds: [],
        evidenceIds: [],
        notes: null,
        provenance: "inferred",
      });
    }
  }

  return results.sort((a, b) => b.priority - a.priority);
}
