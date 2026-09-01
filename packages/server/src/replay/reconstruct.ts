import {
  REDACTED,
  assertOneVariable,
  describeMutation,
  redactBody,
  redactHeaders,
  sanitizeUrl,
} from "@surfacetrace/core";
import type {
  ExperimentMutation,
  HttpMethod,
  IdentityContext,
  Observation,
} from "@surfacetrace/core";
import {
  mergeRuntimeCredentialHeaders,
  validateOutboundHeaders,
} from "./credentialHeaders.js";

export interface RuntimeCredential {
  headers: Record<string, string>;
  cookies: Record<string, string>;
  approvedApiKeyHeaderNames?: string[];
}

export interface ReconstructedRequest {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body: string | null;
  mutationDescription: string;
  preview: ReplayRequestPreview;
  baselinePreview: ReplayRequestPreview;
  targetIdentityId: string | null;
}

export interface ReplayRequestPreview {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

export function reconstructRequest(
  baseline: Observation,
  mutation: ExperimentMutation,
  identities: readonly IdentityContext[],
  credentials: ReadonlyMap<string, RuntimeCredential>,
  targetIdentityId?: string | null,
): ReconstructedRequest {
  const kind = assertOneVariable(mutation);
  const url = new URL(baseline.url);
  let headers = replayableHeaders(baseline.http.request.headers);
  let body = baseline.http.request.body;
  let replayIdentityId = baseline.identityId;

  if (kind === "pathParam") {
    const change = mutation.pathParam!;
    const segments = url.pathname.split("/");
    const index = segments.findIndex(
      (segment) => decodeURIComponent(segment) === change.from,
    );
    if (index < 0)
      throw new Error("Declared path baseline value was not found");
    segments[index] = encodeURIComponent(change.to);
    url.pathname = segments.join("/");
  }
  if (kind === "queryParam") {
    const change = mutation.queryParam!;
    if (url.searchParams.get(change.name) !== change.from)
      throw new Error("Declared query baseline value does not match");
    if (change.to === null) url.searchParams.delete(change.name);
    else url.searchParams.set(change.name, change.to);
  }
  if (kind === "header") {
    const change = mutation.header!;
    const key = headerKey(headers, change.name);
    const current = key ? headers[key] : null;
    if (current !== change.from)
      throw new Error("Declared header baseline value does not match");
    if (key) delete headers[key];
    if (change.to !== null) headers[change.name] = change.to;
  }
  if (kind === "bodyField") {
    if (!body) throw new Error("Baseline has no replayable JSON body");
    let parsed: unknown;
    try {
      parsed = JSON.parse(body) as unknown;
    } catch {
      throw new Error("Body-field replay requires a JSON baseline body");
    }
    const change = mutation.bodyField!;
    setJsonPath(parsed, change.path, change.from, change.to);
    body = JSON.stringify(parsed);
  }
  if (kind === "identity") {
    const baselineIdentity = identities.find(
      (item) => item.id === baseline.identityId,
    );
    if (
      !baselineIdentity ||
      baselineIdentity.role !== mutation.identity!.fromRole
    )
      throw new Error(
        "Baseline identity does not match the declared role mutation",
      );
    if (!targetIdentityId)
      throw new Error("Identity replay requires an explicit targetIdentityId");
    const identity = identities.find((item) => item.id === targetIdentityId);
    if (!identity || identity.role !== mutation.identity!.toRole)
      throw new Error(
        "Target identity does not match the declared role mutation",
      );
    replayIdentityId = targetIdentityId;
  }

  const baselineNeedsCredentials = hasRedactedCredential(baseline);
  if (baselineNeedsCredentials || kind === "identity") {
    if (!replayIdentityId)
      throw new Error("Replay credentials are unavailable for this baseline");
    const material = credentials.get(replayIdentityId);
    if (!material)
      throw new Error(
        "Replay credentials are unavailable for the selected identity",
      );
    headers = mergeRuntimeCredentialHeaders(
      headers,
      material.headers,
      material.approvedApiKeyHeaderNames,
    );
    const cookie = Object.entries(material.cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
    if (cookie) headers.Cookie = cookie;
  }
  if (Object.values(headers).some((value) => value.includes(REDACTED)))
    throw new Error(
      "Replay unavailable because the baseline contains redacted header material",
    );
  validateOutboundHeaders(headers);
  if (
    url.toString().includes(encodeURIComponent(REDACTED)) ||
    url.toString().includes(REDACTED)
  )
    throw new Error(
      "Replay unavailable because the baseline URL contains redacted material",
    );
  if (body?.includes(REDACTED))
    throw new Error(
      "Replay unavailable because the baseline body contains redacted material",
    );

  const safeHeaders = redactHeaders(headers);
  const safeBody = redactBody(body, contentType(headers));
  return {
    method: baseline.method,
    url: url.toString(),
    headers,
    body,
    mutationDescription: describeMutation(mutation),
    baselinePreview: requestPreview(
      baseline.method,
      baseline.url,
      redactHeaders(baseline.http.request.headers),
      redactBody(
        baseline.http.request.body,
        contentType(baseline.http.request.headers),
      ),
    ),
    preview: requestPreview(
      baseline.method,
      url.toString(),
      safeHeaders,
      safeBody,
    ),
    targetIdentityId: replayIdentityId,
  };
}

function replayableHeaders(
  values: Record<string, string>,
): Record<string, string> {
  const blocked = new Set([
    "host",
    "content-length",
    "connection",
    "transfer-encoding",
    "upgrade",
    "proxy-authorization",
  ]);
  return Object.fromEntries(
    Object.entries(values).filter(([name]) => !blocked.has(name.toLowerCase())),
  );
}

function hasRedactedCredential(observation: Observation): boolean {
  return (
    Object.entries(observation.http.request.headers).some(
      ([name, value]) =>
        ["authorization", "cookie", "x-api-key"].includes(name.toLowerCase()) &&
        value.includes(REDACTED),
    ) || Object.keys(observation.http.request.cookies).length > 0
  );
}

function headerKey(
  headers: Record<string, string>,
  name: string,
): string | null {
  return (
    Object.keys(headers).find(
      (candidate) => candidate.toLowerCase() === name.toLowerCase(),
    ) ?? null
  );
}

function setJsonPath(
  value: unknown,
  path: string,
  expected: unknown,
  replacement: unknown,
): void {
  const keys = path.split(".").filter(Boolean);
  if (!keys.length) throw new Error("Body mutation path is required");
  let parent: unknown = value;
  for (const key of keys.slice(0, -1)) {
    if (!parent || typeof parent !== "object" || !(key in parent))
      throw new Error("Declared body field was not found");
    parent = (parent as Record<string, unknown>)[key];
  }
  const key = keys.at(-1)!;
  if (!parent || typeof parent !== "object" || !(key in parent))
    throw new Error("Declared body field was not found");
  if (
    JSON.stringify((parent as Record<string, unknown>)[key]) !==
    JSON.stringify(expected)
  )
    throw new Error("Declared body baseline value does not match");
  (parent as Record<string, unknown>)[key] = replacement;
}

function contentType(headers: Record<string, string>): string {
  const key = headerKey(headers, "content-type");
  return key ? headers[key]! : "";
}

function requestPreview(
  method: HttpMethod,
  urlValue: string,
  headers: Record<string, string>,
  body: string | null,
): ReplayRequestPreview {
  return {
    method,
    url: sanitizeUrl(urlValue),
    headers,
    body,
  };
}

export function formatRequestPreview(preview: ReplayRequestPreview): string {
  const url = new URL(preview.url);
  const lines = [
    `${preview.method} ${url.pathname}${url.search} HTTP/1.1`,
    `Host: ${url.host}`,
    ...Object.entries(preview.headers)
      .filter(([name]) => name.toLowerCase() !== "host")
      .map(([name, value]) => `${name}: ${value}`),
  ];
  if (preview.body !== null) lines.push("", preview.body);
  return lines.join("\n");
}
