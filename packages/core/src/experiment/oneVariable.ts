import type { ExperimentMutation } from "../types.js";

export type MutationKind =
  | "pathParam"
  | "queryParam"
  | "header"
  | "bodyField"
  | "identity";

/**
 * Returns the single changed dimension, or throws if zero / multiple.
 * This is the killer invariant of SurfaceTrace experiments.
 */
export function assertOneVariable(mutation: ExperimentMutation): MutationKind {
  const set: MutationKind[] = [];
  if (mutation.pathParam !== undefined) set.push("pathParam");
  if (mutation.queryParam !== undefined) set.push("queryParam");
  if (mutation.header !== undefined) set.push("header");
  if (mutation.bodyField !== undefined) set.push("bodyField");
  if (mutation.identity !== undefined) set.push("identity");

  if (set.length === 0) {
    throw new Error("Experiment must change exactly one variable; none provided");
  }
  if (set.length > 1) {
    throw new Error(
      `Experiment must change exactly one variable; got: ${set.join(", ")}`
    );
  }
  return set[0]!;
}

export function describeMutation(mutation: ExperimentMutation): string {
  const kind = assertOneVariable(mutation);
  switch (kind) {
    case "pathParam": {
      const m = mutation.pathParam!;
      return `path.${m.name}: ${m.from} → ${m.to}`;
    }
    case "queryParam": {
      const m = mutation.queryParam!;
      return `query.${m.name}: ${m.from ?? "(absent)"} → ${m.to ?? "(absent)"}`;
    }
    case "header": {
      const m = mutation.header!;
      return `header.${m.name}: ${m.from ?? "(absent)"} → ${m.to ?? "(absent)"}`;
    }
    case "bodyField": {
      const m = mutation.bodyField!;
      return `body.${m.path}: ${JSON.stringify(m.from)} → ${JSON.stringify(m.to)}`;
    }
    case "identity": {
      const m = mutation.identity!;
      return `identity: ${m.fromRole} → ${m.toRole}`;
    }
  }
}
