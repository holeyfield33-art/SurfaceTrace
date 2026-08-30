import type {
  Endpoint,
  Hypothesis,
  InputDescriptor,
  Observation,
  ObservationInput,
} from "../types.js";
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

const DESTINATION_NAMES = new Set([
  "url",
  "uri",
  "href",
  "link",
  "endpoint",
  "host",
  "hostname",
  "domain",
  "destination",
  "dest",
  "target",
  "source",
  "src",
  "callback",
  "callbackurl",
  "redirect",
  "redirecturl",
  "returnurl",
  "next",
  "webhook",
  "webhookurl",
  "image",
  "imageurl",
  "avatarurl",
  "feed",
  "feedurl",
  "proxy",
  "remote",
  "resource",
  "downloadurl",
]);
const AMBIGUOUS_REDIRECT_NAMES = new Set([
  "callback",
  "callbackurl",
  "redirect",
  "redirecturl",
  "returnurl",
  "next",
]);
const FALSE_POSITIVE_NAMES = new Set([
  "username",
  "userid",
  "sourcecode",
  "hostedplan",
  "targetcount",
  "imagewidth",
  "linkcolor",
  "domainknowledge",
]);
const TEACHING_CONTEXT =
  "This input appears capable of describing a destination. SSRF becomes relevant only if the SERVER, rather than the browser, uses that value to make another request. You have not established that yet.";
const NEXT_STEPS = [
  "Does the browser fetch it or does the server?",
  "What HTTP request contains the destination?",
  "What response behavior changes when the destination changes?",
  "Is a network trust boundary crossed?",
];

function normalizedName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[._\-\s]+/)
    .join("")
    .toLowerCase();
}

function isDestinationName(name: string): boolean {
  const normalized = normalizedName(name);
  return (
    !FALSE_POSITIVE_NAMES.has(normalized) && DESTINATION_NAMES.has(normalized)
  );
}

function isRedirectName(name: string): boolean {
  return AMBIGUOUS_REDIRECT_NAMES.has(normalizedName(name));
}

function absoluteUrlValue(
  observation: Observation,
  input: ObservationInput,
): boolean {
  let value: unknown;
  if (input.location === "query")
    value = observation.http.request.query[input.name];
  if (input.location === "header")
    value = observation.http.request.headers[input.name];
  if (input.location === "body-form" && observation.http.request.body) {
    value = new URLSearchParams(observation.http.request.body).get(input.name);
  }
  if (input.location === "body-json" && observation.http.request.body) {
    try {
      value = input.name
        .split(".")
        .reduce<unknown>(
          (current, key) =>
            current && typeof current === "object"
              ? (current as Record<string, unknown>)[key]
              : undefined,
          JSON.parse(observation.http.request.body) as unknown,
        );
    } catch {
      value = undefined;
    }
  }
  return typeof value === "string" && /^https?:\/\/[^\s]+$/i.test(value);
}

function ssrfHypotheses(
  ep: Endpoint,
  inputs: InputDescriptor[],
  observations: Observation[],
): Hypothesis[] {
  const results: Hypothesis[] = [];
  for (const input of inputs) {
    const observedInputs = observations
      .filter((observation) => observation.endpointId === ep.id)
      .flatMap((observation) =>
        observation.parsedInputs.map((item) => ({ observation, item })),
      )
      .filter(
        ({ item }) =>
          item.location === input.location &&
          item.name.toLowerCase() === input.name.toLowerCase(),
      );
    const hasAbsoluteUrl = observedInputs.some(({ observation, item }) =>
      absoluteUrlValue(observation, item),
    );
    if (!isDestinationName(input.name) && !hasAbsoluteUrl) continue;
    const displayName = `${input.location}.${input.name}`;
    const signalReason = hasAbsoluteUrl
      ? `${displayName} contains an absolute HTTP/HTTPS URL`
      : `${displayName} has a destination-like input name`;
    const question = `Does ${displayName} cause the application server to retrieve the supplied destination?`;
    results.push({
      id: hashPayload({
        ep: ep.id,
        input: input.id,
        signal: "server-side-outbound-request",
      }).slice(0, 16),
      endpointId: ep.id,
      question,
      signal: "server-side-outbound-request-review",
      strideCategory: "Spoofing",
      priority: hasAbsoluteUrl ? 8 : 7,
      status: "open",
      observationIds: [],
      experimentIds: [],
      assetIds: [],
      trustBoundaryIds: [],
      evidenceIds: [],
      notes: null,
      provenance: "inferred",
      reasoning: {
        category: "ssrf",
        inputId: input.id,
        inputName: input.name,
        inputLocation: input.location,
        signalType: hasAbsoluteUrl ? "absolute_url" : "input_name",
        signalReason,
        signalStrength: hasAbsoluteUrl ? "strong" : "moderate",
        valueClass: hasAbsoluteUrl ? "absolute URL" : null,
        followUpQuestion:
          "If server-side fetching occurs, what destinations, protocols, and trust boundaries are permitted?",
        teachingContext: TEACHING_CONTEXT,
        nextSteps: NEXT_STEPS,
      },
    });
    if (isRedirectName(input.name)) {
      results.push({
        id: hashPayload({
          ep: ep.id,
          input: input.id,
          signal: "client-redirect-review",
        }).slice(0, 16),
        endpointId: ep.id,
        question: `Does ${displayName} control where the client is redirected?`,
        signal: "user-controlled-redirect",
        strideCategory: "Spoofing",
        priority: 7,
        status: "open",
        observationIds: [],
        experimentIds: [],
        assetIds: [],
        trustBoundaryIds: [],
        evidenceIds: [],
        notes: null,
        provenance: "inferred",
        reasoning: {
          category: "redirect",
          inputId: input.id,
          inputName: input.name,
          inputLocation: input.location,
          signalType: "input_name",
          signalReason: `${displayName} is ambiguous between redirect and server-fetch behavior`,
          signalStrength: "moderate",
          valueClass: hasAbsoluteUrl ? "absolute URL" : null,
          followUpQuestion:
            "This redirect question is separate from the server-fetch question.",
          teachingContext:
            "A redirect changes where the client navigates; SSRF requires the server to make another request. Neither behavior has been established.",
          nextSteps: NEXT_STEPS,
        },
      });
    }
  }
  return results;
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
  observations: Observation[] = [],
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
        reasoning: null,
      });
    }
    results.push(...ssrfHypotheses(ep, epInputs, observations));
  }

  return results.sort((a, b) => b.priority - a.priority);
}
