import type { DiffCard, Observation } from "../types.js";

function jsonKeys(shape: string | null): Set<string> {
  if (!shape) return new Set();
  try {
    const parsed = JSON.parse(shape) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(Object.keys(parsed as Record<string, unknown>));
  } catch {
    return new Set();
  }
}

export function compareObservations(
  experimentId: string,
  baseline: Observation,
  result: Observation
): DiffCard {
  const statusChanged = baseline.responseStatus !== result.responseStatus;
  const lengthDelta = result.responseSize - baseline.responseSize;

  const baseHeaders = new Set(Object.keys(baseline.responseHeaders));
  const resultHeaders = new Set(Object.keys(result.responseHeaders));
  const headerChanges: string[] = [];
  for (const h of resultHeaders) {
    if (!baseHeaders.has(h)) headerChanges.push(`+${h}`);
    else if (baseline.responseHeaders[h] !== result.responseHeaders[h]) {
      headerChanges.push(`~${h}`);
    }
  }
  for (const h of baseHeaders) {
    if (!resultHeaders.has(h)) headerChanges.push(`-${h}`);
  }

  const baseKeys = jsonKeys(baseline.responseBodyShape);
  const resultKeys = jsonKeys(result.responseBodyShape);
  const jsonKeysAdded = [...resultKeys].filter((k) => !baseKeys.has(k));
  const jsonKeysRemoved = [...baseKeys].filter((k) => !resultKeys.has(k));

  const parts: string[] = [];
  if (statusChanged) {
    parts.push(`Status: ${baseline.responseStatus} → ${result.responseStatus}`);
  }
  if (lengthDelta !== 0) {
    parts.push(`Size delta: ${lengthDelta > 0 ? "+" : ""}${lengthDelta}`);
  }
  if (jsonKeysAdded.length) {
    parts.push(`Keys added: ${jsonKeysAdded.join(", ")}`);
  }
  if (jsonKeysRemoved.length) {
    parts.push(`Keys removed: ${jsonKeysRemoved.join(", ")}`);
  }
  if (headerChanges.length) {
    parts.push(`Header changes: ${headerChanges.slice(0, 5).join(", ")}`);
  }
  if (parts.length === 0) {
    parts.push("No material difference observed");
  }

  return {
    experimentId,
    statusChanged,
    statusFrom: baseline.responseStatus,
    statusTo: result.responseStatus,
    lengthDelta,
    headerChanges,
    jsonKeysAdded,
    jsonKeysRemoved,
    summary: parts.join("; "),
    confidence: "single",
  };
}
