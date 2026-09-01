import type {
  Asset,
  EvidenceRecord,
  Experiment,
  Hypothesis,
  IdentityContext,
  ImportResult,
  TrustBoundary,
} from "@surfacetrace/core";

export interface ImportReplacementSummary {
  previousImportId: string;
  identityAssignmentsRemoved: number;
  assetEndpointLinksRemoved: number;
  assetObservationLinksRemoved: number;
  trustBoundariesRemoved: number;
  experimentsRemoved: number;
  preparedReplaysInvalidated: number;
}

export function reconcileImportScopedState(input: {
  previousImport: ImportResult | null;
  previousHypotheses: Hypothesis[] | null;
  nextImport: ImportResult;
  nextHypotheses: Hypothesis[];
  identities: IdentityContext[];
  assets: Asset[];
  trustBoundaries: TrustBoundary[];
  experiments: Experiment[];
  evidence: readonly EvidenceRecord[];
}): {
  identities: IdentityContext[];
  assets: Asset[];
  trustBoundaries: TrustBoundary[];
  hypotheses: Hypothesis[];
  experiments: Experiment[];
  summary: Omit<
    ImportReplacementSummary,
    "previousImportId" | "preparedReplaysInvalidated"
  >;
} {
  const observationIds = new Set(
    input.nextImport.observations.map((item) => item.id),
  );
  const endpointIds = new Set(input.nextImport.endpoints.map((item) => item.id));
  const hypothesisIds = new Set(input.nextHypotheses.map((item) => item.id));
  let identityAssignmentsRemoved = 0;
  const assignedObservationIds = new Set<string>();
  const identityByObservation = new Map<string, string>();
  const identities = input.identities.map((identity) => {
    const associatedObservationIds = identity.associatedObservationIds.filter(
      (id) => {
        const keep = observationIds.has(id) && !assignedObservationIds.has(id);
        if (keep) {
          assignedObservationIds.add(id);
          identityByObservation.set(id, identity.id);
        }
        return keep;
      },
    );
    identityAssignmentsRemoved +=
      identity.associatedObservationIds.length - associatedObservationIds.length;
    return { ...identity, associatedObservationIds };
  });
  for (const observation of input.nextImport.observations)
    observation.identityId = identityByObservation.get(observation.id) ?? null;

  let assetEndpointLinksRemoved = 0;
  let assetObservationLinksRemoved = 0;
  const assets = input.assets.map((asset) => {
    const linkedEndpointIds = asset.linkedEndpointIds.filter((id) =>
      endpointIds.has(id),
    );
    const linkedObservationIds = asset.linkedObservationIds.filter((id) =>
      observationIds.has(id),
    );
    assetEndpointLinksRemoved +=
      asset.linkedEndpointIds.length - linkedEndpointIds.length;
    assetObservationLinksRemoved +=
      asset.linkedObservationIds.length - linkedObservationIds.length;
    return { ...asset, linkedEndpointIds, linkedObservationIds };
  });

  const experiments = input.experiments.filter(
    (experiment) =>
      endpointIds.has(experiment.endpointId) &&
      observationIds.has(experiment.baselineObservationId) &&
      (experiment.resultObservationId === null ||
        observationIds.has(experiment.resultObservationId)) &&
      (experiment.hypothesisId === null ||
        hypothesisIds.has(experiment.hypothesisId)),
  );
  const experimentIds = new Set(experiments.map((item) => item.id));
  const previousImportRefs = new Set([
    ...(input.previousImport?.observations.map((item) => item.id) ?? []),
    ...(input.previousImport?.endpoints.map((item) => item.id) ?? []),
    ...(input.previousImport?.inputs.map((item) => item.id) ?? []),
    ...(input.previousHypotheses?.map((item) => item.id) ?? []),
    ...input.experiments.map((item) => item.id),
  ]);
  const nextImportRefs = new Set([
    ...observationIds,
    ...endpointIds,
    ...input.nextImport.inputs.map((item) => item.id),
    ...hypothesisIds,
    ...experimentIds,
  ]);
  const trustBoundaries = input.trustBoundaries.filter(
    (boundary) =>
      ![boundary.sourceRef, boundary.destinationRef].some(
        (ref) => previousImportRefs.has(ref) && !nextImportRefs.has(ref),
      ),
  );

  const previousHypothesisById = new Map(
    (input.previousHypotheses ?? []).map((item) => [item.id, item]),
  );
  const assetIds = new Set(assets.map((item) => item.id));
  const trustBoundaryIds = new Set(trustBoundaries.map((item) => item.id));
  const evidenceIds = new Set(input.evidence.map((item) => item.id));
  const hypotheses = input.nextHypotheses.map((hypothesis) => {
    const previous = previousHypothesisById.get(hypothesis.id);
    if (!previous) return hypothesis;
    return {
      ...hypothesis,
      status: previous.status,
      observationIds: previous.observationIds.filter((id) =>
        observationIds.has(id),
      ),
      experimentIds: unique([
        ...previous.experimentIds.filter((id) => experimentIds.has(id)),
        ...experiments
          .filter((item) => item.hypothesisId === hypothesis.id)
          .map((item) => item.id),
      ]),
      assetIds: previous.assetIds.filter((id) => assetIds.has(id)),
      trustBoundaryIds: previous.trustBoundaryIds.filter((id) =>
        trustBoundaryIds.has(id),
      ),
      evidenceIds: previous.evidenceIds.filter((id) => evidenceIds.has(id)),
      notes: previous.notes,
    };
  });

  return {
    identities,
    assets,
    trustBoundaries,
    hypotheses,
    experiments,
    summary: {
      identityAssignmentsRemoved,
      assetEndpointLinksRemoved,
      assetObservationLinksRemoved,
      trustBoundariesRemoved:
        input.trustBoundaries.length - trustBoundaries.length,
      experimentsRemoved: input.experiments.length - experiments.length,
    },
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
