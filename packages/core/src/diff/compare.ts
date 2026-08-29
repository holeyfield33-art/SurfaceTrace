import type { BodyChange, DiffCard, Observation } from "../types.js";
import { redactBody } from "../har/redact.js";

export interface DeepDiffLimits {
  maxDepth: number;
  maxNodes: number;
  maxDiffRecords: number;
}
const DEFAULT_LIMITS: DeepDiffLimits = {
  maxDepth: 32,
  maxNodes: 10_000,
  maxDiffRecords: 1_000,
};
interface DiffState {
  changes: BodyChange[];
  nodes: number;
  truncated: boolean;
  reason: DiffCard["truncationReason"];
  limits: DeepDiffLimits;
}

export function compareObservations(
  experimentId: string,
  baseline: Observation,
  result: Observation,
  limits: Partial<DeepDiffLimits> = {},
): DiffCard {
  const statusChanged = baseline.responseStatus !== result.responseStatus;
  const lengthDelta = result.responseSize - baseline.responseSize;
  const headerChanges = compareHeaders(
    baseline.responseHeaders,
    result.responseHeaders,
  );
  const beforeBody = parseSafeJson(
    baseline.http?.response.body ?? baseline.responseBodyShape,
  );
  const afterBody = parseSafeJson(
    result.http?.response.body ?? result.responseBodyShape,
  );
  const state: DiffState = {
    changes: [],
    nodes: 0,
    truncated: false,
    reason: null,
    limits: { ...DEFAULT_LIMITS, ...limits },
  };
  if (beforeBody.ok && afterBody.ok)
    walk(beforeBody.value, afterBody.value, "", 0, state);
  state.changes.sort(
    (a, b) =>
      a.path.localeCompare(b.path) || a.changeType.localeCompare(b.changeType),
  );
  const jsonKeysAdded = state.changes
    .filter((item) => item.changeType === "added")
    .map((item) => item.path);
  const jsonKeysRemoved = state.changes
    .filter((item) => item.changeType === "removed")
    .map((item) => item.path);
  const bodyComparison =
    !beforeBody.ok || !afterBody.ok
      ? "non_json"
      : state.changes.length || state.truncated
        ? "different"
        : "identical";
  const summary = summarize(state.changes, {
    statusChanged,
    headerChanges,
    lengthDelta,
    truncated: state.truncated,
    reason: state.reason,
    bodyComparison,
  });
  return {
    experimentId,
    statusChanged,
    statusFrom: baseline.responseStatus,
    statusTo: result.responseStatus,
    lengthDelta,
    headerChanges,
    jsonKeysAdded,
    jsonKeysRemoved,
    bodyChanges: state.changes,
    bodyChangeCount: state.changes.length,
    bodyComparison,
    truncated: state.truncated,
    truncationReason: state.reason,
    summary,
    confidence: "single",
  };
}

function parseSafeJson(
  text: string | null,
): { ok: true; value: unknown } | { ok: false } {
  if (text === null) return { ok: false };
  try {
    const safe = redactBody(
      JSON.stringify(JSON.parse(text) as unknown),
      "application/json",
    );
    return { ok: true, value: JSON.parse(safe ?? "null") as unknown };
  } catch {
    return { ok: false };
  }
}

function walk(
  before: unknown,
  after: unknown,
  path: string,
  depth: number,
  state: DiffState,
): void {
  if (state.truncated) return;
  if (depth > state.limits.maxDepth) return truncate(state, "max_depth");
  if (++state.nodes > state.limits.maxNodes)
    return truncate(state, "max_nodes");
  if (valueType(before) !== valueType(after))
    return record(state, {
      path: path || "$",
      changeType: "type_changed",
      before,
      after,
    });
  if (Array.isArray(before) && Array.isArray(after)) {
    if (before.length !== after.length)
      record(state, {
        path: joinPath(path, "length"),
        changeType: "array_length_changed",
        before: before.length,
        after: after.length,
      });
    const common = Math.min(before.length, after.length);
    for (let i = 0; i < common; i += 1)
      walk(before[i], after[i], `${path || "$"}[${i}]`, depth + 1, state);
    for (let i = common; i < before.length; i += 1)
      record(state, {
        path: `${path || "$"}[${i}]`,
        changeType: "removed",
        before: before[i],
        after: null,
      });
    for (let i = common; i < after.length; i += 1)
      record(state, {
        path: `${path || "$"}[${i}]`,
        changeType: "added",
        before: null,
        after: after[i],
      });
    return;
  }
  if (isObject(before) && isObject(after)) {
    for (const key of [
      ...new Set([...Object.keys(before), ...Object.keys(after)]),
    ].sort()) {
      const childPath = joinPath(path, key);
      if (!Object.hasOwn(before, key))
        record(state, {
          path: childPath,
          changeType: "added",
          before: null,
          after: after[key],
        });
      else if (!Object.hasOwn(after, key))
        record(state, {
          path: childPath,
          changeType: "removed",
          before: before[key],
          after: null,
        });
      else walk(before[key], after[key], childPath, depth + 1, state);
    }
    return;
  }
  if (!Object.is(before, after))
    record(state, {
      path: path || "$",
      changeType: "value_changed",
      before,
      after,
    });
}

function record(state: DiffState, change: BodyChange): void {
  if (!state.truncated)
    state.changes.length >= state.limits.maxDiffRecords
      ? truncate(state, "max_diff_records")
      : state.changes.push(change);
}
function truncate(
  state: DiffState,
  reason: NonNullable<DiffCard["truncationReason"]>,
): void {
  state.truncated = true;
  state.reason = reason;
}
function valueType(value: unknown): string {
  return value === null
    ? "null"
    : Array.isArray(value)
      ? "array"
      : typeof value;
}
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function joinPath(parent: string, child: string): string {
  return parent ? `${parent}.${child}` : child;
}
function compareHeaders(
  before: Record<string, string>,
  after: Record<string, string>,
): string[] {
  const changes: string[] = [];
  for (const name of [
    ...new Set([...Object.keys(before), ...Object.keys(after)]),
  ].sort()) {
    if (!(name in before)) changes.push(`+${name}`);
    else if (!(name in after)) changes.push(`-${name}`);
    else if (before[name] !== after[name]) changes.push(`~${name}`);
  }
  return changes;
}
function summarize(
  changes: BodyChange[],
  meta: {
    statusChanged: boolean;
    headerChanges: string[];
    lengthDelta: number;
    truncated: boolean;
    reason: DiffCard["truncationReason"];
    bodyComparison: DiffCard["bodyComparison"];
  },
): string {
  const parts: string[] = [];
  if (changes.length)
    parts.push(
      `${changes.length} response field change${changes.length === 1 ? "" : "s"}`,
    );
  const groups: Array<[string, BodyChange["changeType"][]]> = [
    ["Added", ["added"]],
    ["Removed", ["removed"]],
    ["Changed", ["value_changed"]],
    ["Type changes", ["type_changed"]],
    ["Array changes", ["array_length_changed"]],
  ];
  for (const [label, types] of groups) {
    const paths = changes
      .filter((item) => types.includes(item.changeType))
      .map((item) => item.path);
    if (paths.length) parts.push(`${label}: ${paths.join(", ")}`);
  }
  if (meta.statusChanged) parts.push("Status changed");
  if (meta.headerChanges.length)
    parts.push(`Headers changed: ${meta.headerChanges.join(", ")}`);
  if (meta.lengthDelta !== 0)
    parts.push(
      `Size delta: ${meta.lengthDelta > 0 ? "+" : ""}${meta.lengthDelta}`,
    );
  if (meta.bodyComparison === "non_json")
    parts.push("Body: non-JSON comparison unavailable");
  if (meta.truncated) parts.push(`Truncated: ${meta.reason}`);
  return parts.length ? parts.join("; ") : "No material difference observed";
}
