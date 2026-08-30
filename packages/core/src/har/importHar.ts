import type { HarEntry, HarFile } from "./types.js";
import { extractPathParams, toPathTemplate } from "./pathTemplate.js";
import {
  REDACTED,
  bodyShape,
  isSensitiveHeader,
  isSensitiveQueryParam,
  redactBody,
  redactHeaders,
  sanitizeUrl,
} from "./redact.js";
import { hashPayload } from "../evidence/hash.js";
import type {
  Endpoint,
  HttpMethod,
  InputDescriptor,
  InputLocation,
  Observation,
} from "../types.js";

export interface ImportResult {
  observations: Observation[];
  endpoints: Endpoint[];
  inputs: InputDescriptor[];
  skippedEntries: number;
}

interface ExtractedInput {
  name: string;
  location: InputLocation;
  type: string;
  sensitive: boolean;
}

const RELEVANT_HEADERS = new Set([
  "authorization",
  "origin",
  "referer",
  "content-type",
  "x-csrf-token",
]);

function headersToRecord(
  headers: { name: string; value: string }[],
): Record<string, string> {
  return Object.fromEntries(headers.map(({ name, value }) => [name, value]));
}

function isHttpMethod(method: string): method is HttpMethod {
  return ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(
    method.toUpperCase(),
  );
}

function inferType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "string" && /^-?\d+$/.test(value)) return "integer";
  return typeof value;
}

function jsonInputs(value: unknown, prefix = ""): ExtractedInput[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const inputs: ExtractedInput[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object" && !Array.isArray(child))
      inputs.push(...jsonInputs(child, name));
    else
      inputs.push({
        name,
        location: "body-json",
        type: inferType(child),
        sensitive: isSensitiveQueryParam(key),
      });
  }
  return inputs;
}

function extractInputs(
  entry: HarEntry,
  url: URL,
  template: string,
): ExtractedInput[] {
  const inputs: ExtractedInput[] = [];
  for (const [name, value] of Object.entries(
    extractPathParams(url.pathname, template),
  )) {
    inputs.push({
      name,
      location: "path",
      type: inferType(value),
      sensitive: false,
    });
  }
  for (const [name, value] of url.searchParams.entries()) {
    inputs.push({
      name,
      location: "query",
      type: inferType(value),
      sensitive: isSensitiveQueryParam(name),
    });
  }
  for (const header of entry.request.headers) {
    const lower = header.name.toLowerCase();
    if (RELEVANT_HEADERS.has(lower) || lower.startsWith("x-")) {
      inputs.push({
        name: header.name,
        location: "header",
        type: "string",
        sensitive: isSensitiveHeader(header.name),
      });
    }
  }
  for (const cookie of entry.request.cookies ?? []) {
    inputs.push({
      name: cookie.name,
      location: "cookie",
      type: "string",
      sensitive: true,
    });
  }
  const postData = entry.request.postData;
  const mime = postData?.mimeType.toLowerCase() ?? "";
  if (postData && mime.includes("json") && postData.text) {
    try {
      inputs.push(...jsonInputs(JSON.parse(postData.text) as unknown));
    } catch {
      /* Keep only non-JSON shape metadata. */
    }
  } else if (
    postData &&
    (mime.includes("x-www-form-urlencoded") ||
      mime.includes("multipart/form-data"))
  ) {
    const params =
      postData.params ??
      (mime.includes("x-www-form-urlencoded") && postData.text
        ? [...new URLSearchParams(postData.text)].map(([name, value]) => ({
            name,
            value,
          }))
        : []);
    for (const param of params) {
      inputs.push({
        name: param.name,
        location: "body-form",
        type: "string",
        sensitive: isSensitiveQueryParam(param.name),
      });
    }
  }
  return inputs;
}

function addInput(
  map: Map<string, InputDescriptor>,
  endpointId: string,
  input: ExtractedInput,
): void {
  const key = `${endpointId}:${input.location}:${input.name.toLowerCase()}`;
  const existing = map.get(key);
  if (existing) {
    existing.observedCount += 1;
    if (!existing.sampleTypes.includes(input.type))
      existing.sampleTypes.push(input.type);
    if (input.sensitive) existing.sensitivity = "sensitive";
    return;
  }
  map.set(key, {
    id: hashPayload({ key }).slice(0, 16),
    endpointId,
    name: input.name,
    location: input.location,
    sampleTypes: [input.type],
    sensitivity: input.sensitive ? "sensitive" : "normal",
    observedCount: 1,
    appearsRequired: null,
  });
}

export function importHar(har: HarFile): ImportResult {
  const observations: Observation[] = [];
  const endpointMap = new Map<string, Endpoint>();
  const inputMap = new Map<string, InputDescriptor>();
  let skippedEntries = 0;
  for (const entry of har.log.entries) {
    const normalized = entryToObservation(entry);
    if (!normalized) {
      skippedEntries += 1;
      continue;
    }
    const { observation, sourceUrl } = normalized;
    const key = `${observation.method} ${sourceUrl.host}${observation.pathTemplate}`;
    let endpoint = endpointMap.get(key);
    if (!endpoint) {
      endpoint = {
        id: hashPayload({ key }).slice(0, 16),
        method: observation.method,
        host: sourceUrl.host,
        pathTemplate: observation.pathTemplate,
        firstSeen: observation.capturedAt,
        lastSeen: observation.capturedAt,
        statusCodes: [observation.responseStatus],
        requiresAuth: null,
        observationCount: 1,
      };
      endpointMap.set(key, endpoint);
    } else {
      endpoint.lastSeen = observation.capturedAt;
      endpoint.observationCount += 1;
      if (!endpoint.statusCodes.includes(observation.responseStatus))
        endpoint.statusCodes.push(observation.responseStatus);
    }
    observation.endpointId = endpoint.id;
    observations.push(observation);
    for (const input of extractInputs(
      entry,
      sourceUrl,
      observation.pathTemplate,
    ))
      addInput(inputMap, endpoint.id, input);
  }
  return {
    observations,
    endpoints: [...endpointMap.values()],
    inputs: [...inputMap.values()],
    skippedEntries,
  };
}

function entryToObservation(
  entry: HarEntry,
): { observation: Observation; sourceUrl: URL } | null {
  if (
    !entry?.request ||
    !entry.response ||
    !isHttpMethod(entry.request.method) ||
    !Array.isArray(entry.request.headers) ||
    !Array.isArray(entry.response.headers)
  )
    return null;
  let sourceUrl: URL;
  try {
    sourceUrl = new URL(entry.request.url);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(sourceUrl.protocol)) return null;
  const sanitizedUrl = sanitizeUrl(entry.request.url);
  const pathTemplate = toPathTemplate(sourceUrl.pathname);
  const requestHeaders = redactHeaders(headersToRecord(entry.request.headers));
  const responseHeaders = redactHeaders(
    headersToRecord(entry.response.headers),
  );
  const parsedInputs = extractInputs(entry, sourceUrl, pathTemplate);
  const cookies = Object.fromEntries(
    (entry.request.cookies ?? []).map((cookie) => [cookie.name, REDACTED]),
  );
  const query = Object.fromEntries(
    [...sourceUrl.searchParams].map(([name, value]) => [
      name,
      isSensitiveQueryParam(name) ? REDACTED : value,
    ]),
  );
  const safeRequestHeaders = { ...requestHeaders };
  if (
    !Object.keys(safeRequestHeaders).some(
      (name) => name.toLowerCase() === "host",
    )
  )
    safeRequestHeaders.Host = sourceUrl.host;
  if (
    Object.keys(cookies).length &&
    !Object.keys(safeRequestHeaders).some(
      (name) => name.toLowerCase() === "cookie",
    )
  ) {
    safeRequestHeaders.Cookie = Object.entries(cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }
  const http = {
    request: {
      httpVersion: entry.request.httpVersion ?? "HTTP/1.1",
      target: `${sourceUrl.pathname}${sourceUrl.search ? new URL(sanitizedUrl).search : ""}`,
      headers: safeRequestHeaders,
      cookies,
      query,
      body: redactBody(
        entry.request.postData?.text,
        entry.request.postData?.mimeType,
      ),
    },
    response: {
      httpVersion: entry.response.httpVersion ?? "HTTP/1.1",
      status: entry.response.status,
      statusText: entry.response.statusText,
      headers: responseHeaders,
      body: redactBody(
        entry.response.content?.text,
        entry.response.content?.mimeType,
      ),
    },
  };
  const payload = {
    method: entry.request.method.toUpperCase(),
    url: sanitizedUrl,
    pathTemplate,
    requestHeaders,
    requestBodyShape: bodyShape(entry.request.postData?.text),
    responseStatus: entry.response.status,
    responseHeaders,
    responseBodyShape: bodyShape(entry.response.content?.text),
    responseSize: entry.response.content?.size ?? 0,
    capturedAt: entry.startedDateTime,
    http,
    parsedInputs,
  };
  return {
    sourceUrl,
    observation: {
      id: hashPayload(payload).slice(0, 24),
      endpointId: "",
      method: payload.method as HttpMethod,
      url: sanitizedUrl,
      pathTemplate,
      requestHeaders,
      requestBodyShape: payload.requestBodyShape,
      responseStatus: payload.responseStatus,
      responseHeaders,
      responseBodyShape: payload.responseBodyShape,
      responseSize: payload.responseSize,
      capturedAt: payload.capturedAt,
      redacted: true,
      contentHash: hashPayload(payload),
      http,
      parsedInputs,
      identityId: null,
    },
  };
}

export function parseHarJson(raw: string): HarFile {
  const parsed = JSON.parse(raw) as Partial<HarFile>;
  if (!parsed.log || !Array.isArray(parsed.log.entries))
    throw new Error("Invalid HAR: log.entries must be an array");
  return parsed as HarFile;
}
