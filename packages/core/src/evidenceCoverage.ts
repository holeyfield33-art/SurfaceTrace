import type { InputDescriptor, Observation, Hypothesis } from "./types.js";

export interface EvidenceCoverageInput {
  observations: Observation[];
  inputs: InputDescriptor[];
  hypotheses: Hypothesis[];
}

export interface EvidenceCoverageFinding {
  title: string;
  detail: string;
}

export interface EvidenceCoverageReport {
  importedObservationCount: number;
  endpointCount: number;
  hostCount: number;
  captureTimeRange: { first: string | null; last: string | null };
  methodsRepresented: string[];
  identityContextsRepresented: string[];
  findings: EvidenceCoverageFinding[];
  questions: string[];
  disclaimer: string;
}

function stableUnique(values: Iterable<string>): string[] {
  return [...new Set([...values].filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function isStateChanging(method: string): boolean {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase());
}

export function buildEvidenceCoverage(
  input: EvidenceCoverageInput,
): EvidenceCoverageReport {
  const observations = [...input.observations].sort((a, b) =>
    a.capturedAt.localeCompare(b.capturedAt) || a.id.localeCompare(b.id),
  );
  const endpoints = stableUnique(observations.map((item) => item.endpointId));
  const hosts = stableUnique(
    observations.map((item) => new URL(item.url).host),
  );
  const methods = stableUnique(observations.map((item) => item.method));
  const identityContexts = stableUnique(
    observations.map((item) => item.identityId ?? "Unassigned"),
  );
  const first = observations[0]?.capturedAt ?? null;
  const last = observations.at(-1)?.capturedAt ?? null;
  const findings: EvidenceCoverageFinding[] = [];

  for (const endpointId of endpoints) {
    const endpointObservations = observations.filter(
      (item) => item.endpointId === endpointId,
    );
    if (endpointObservations.length === 1) {
      findings.push({
        title: "Observed only once",
        detail: `Endpoint ${endpointId} has one imported observation.`,
      });
    }
    const stateChanging = endpointObservations.filter((item) =>
      isStateChanging(item.method),
    );
    if (stateChanging.length && endpointObservations.length < 2) {
      findings.push({
        title: "No comparison observation",
        detail: `Endpoint ${endpointId} includes a state-changing request without a comparison observation.`,
      });
    }
  }

  for (const observation of observations) {
    const requestHeaders = observation.http.request.headers;
    const responseHeaders = observation.http.response.headers;
    const hasAuth = Object.keys(requestHeaders).some(
      (name) => name.toLowerCase() === "authorization",
    );
    const hasRedirect =
      observation.responseStatus >= 300 &&
      observation.responseStatus < 400 &&
      Boolean(responseHeaders.Location ?? responseHeaders.location);
    const sameEndpoint = observations.filter(
      (item) => item.endpointId === observation.endpointId,
    );
    if (hasRedirect && sameEndpoint.length < 2) {
      findings.push({
        title: "No comparison observation",
        detail: `Redirect response on ${observation.method} ${observation.url} lacks a captured destination observation.`,
      });
    }
    if (hasAuth && observation.identityId === null) {
      findings.push({
        title: "Potential evidence gap",
        detail:
          "Authorization header is present but no identity context was assigned.",
      });
    }
    if (!observation.http.request.body || !observation.http.response.body) {
      findings.push({
        title: "Potential evidence gap",
        detail: `Incomplete capture data on ${observation.method} ${observation.url}.`,
      });
    }
  }

  for (const hypothesis of input.hypotheses) {
    if (!hypothesis.reasoning) continue;
    const endpointObservations = observations.filter(
      (item) => item.endpointId === hypothesis.endpointId,
    );
    const usableBaseline = endpointObservations.length >= 2;
    if (!usableBaseline) {
      findings.push({
        title: "No comparison observation",
        detail: `Hypothesis ${hypothesis.id} does not have a usable baseline/comparison pair.`,
      });
    }
  }

  findings.sort((left, right) =>
    left.title.localeCompare(right.title) ||
    left.detail.localeCompare(right.detail),
  );

  return {
    importedObservationCount: observations.length,
    endpointCount: endpoints.length,
    hostCount: hosts.length,
    captureTimeRange: { first, last },
    methodsRepresented: methods,
    identityContextsRepresented: identityContexts,
    findings,
    questions: [
      "Which endpoints still need a second imported observation?",
      "Which redirects need a captured destination comparison?",
      "Which requests need explicit identity assignment before review?",
    ],
    disclaimer:
      "Imported coverage is not proof of complete application coverage.",
  };
}
