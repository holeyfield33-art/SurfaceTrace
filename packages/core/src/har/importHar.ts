import type { HarEntry, HarFile } from "./types.js";
import { toPathTemplate } from "./pathTemplate.js";
import { redactHeaders, bodyShape } from "./redact.js";
import { hashPayload } from "../evidence/hash.js";
import type {
  Endpoint,
  HttpMethod,
  InputDescriptor,
  Observation,
} from "../types.js";

export interface ImportResult {
  observations: Observation[];
  endpoints: Endpoint[];
  inputs: InputDescriptor[];
}

function headersToRecord(
  headers: { name: string; value: string }[]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of headers) {
    out[h.name] = h.value;
  }
  return out;
}

function isHttpMethod(m: string): m is HttpMethod {
  return ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(
    m.toUpperCase()
  );
}

function endpointKey(method: string, host: string, pathTemplate: string): string {
  return `${method.toUpperCase()} ${host}${pathTemplate}`;
}

export function importHar(har: HarFile): ImportResult {
  const observations: Observation[] = [];
  const endpointMap = new Map<string, Endpoint>();
  const inputMap = new Map<string, InputDescriptor>();

  for (const entry of har.log.entries) {
    const obs = entryToObservation(entry);
    if (!obs) continue;
    observations.push(obs);

    const key = endpointKey(obs.method, new URL(obs.url).host, obs.pathTemplate);
    let ep = endpointMap.get(key);
    if (!ep) {
      ep = {
        id: hashPayload({ k: key }).slice(0, 16),
        method: obs.method,
        host: new URL(obs.url).host,
        pathTemplate: obs.pathTemplate,
        firstSeen: obs.capturedAt,
        lastSeen: obs.capturedAt,
        statusCodes: [obs.responseStatus],
        requiresAuth: null,
        observationCount: 1,
      };
      endpointMap.set(key, ep);
    } else {
      ep.lastSeen = obs.capturedAt;
      ep.observationCount += 1;
      if (!ep.statusCodes.includes(obs.responseStatus)) {
        ep.statusCodes.push(obs.responseStatus);
      }
    }
    obs.endpointId = ep.id;

    // Query inputs
    const url = new URL(obs.url);
    for (const name of url.searchParams.keys()) {
      const inputKey = `${ep.id}:query:${name}`;
      if (!inputMap.has(inputKey)) {
        inputMap.set(inputKey, {
          id: hashPayload({ inputKey }).slice(0, 16),
          endpointId: ep.id,
          name,
          location: "query",
          sampleTypes: ["string"],
          appearsRequired: null,
        });
      }
    }
  }

  return {
    observations,
    endpoints: [...endpointMap.values()],
    inputs: [...inputMap.values()],
  };
}

function entryToObservation(entry: HarEntry): Observation | null {
  const { request, response } = entry;
  if (!isHttpMethod(request.method)) return null;

  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }

  const pathTemplate = toPathTemplate(url.pathname);
  const reqHeaders = redactHeaders(headersToRecord(request.headers));
  const resHeaders = redactHeaders(headersToRecord(response.headers));
  const reqBodyShape = bodyShape(request.postData?.text);
  const resBodyShape = bodyShape(response.content?.text);

  const payload = {
    method: request.method.toUpperCase(),
    url: request.url,
    pathTemplate,
    requestHeaders: reqHeaders,
    requestBodyShape: reqBodyShape,
    responseStatus: response.status,
    responseHeaders: resHeaders,
    responseBodyShape: resBodyShape,
    responseSize: response.content?.size ?? 0,
    capturedAt: entry.startedDateTime,
  };

  return {
    id: hashPayload(payload).slice(0, 24),
    endpointId: "", // filled after endpoint clustering
    method: request.method.toUpperCase() as HttpMethod,
    url: request.url,
    pathTemplate,
    requestHeaders: reqHeaders,
    requestBodyShape: reqBodyShape,
    responseStatus: response.status,
    responseHeaders: resHeaders,
    responseBodyShape: resBodyShape,
    responseSize: response.content?.size ?? 0,
    capturedAt: entry.startedDateTime,
    redacted: true,
    contentHash: hashPayload(payload),
  };
}

export function parseHarJson(raw: string): HarFile {
  const parsed = JSON.parse(raw) as unknown;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("log" in parsed) ||
    typeof (parsed as HarFile).log !== "object"
  ) {
    throw new Error("Invalid HAR: missing log object");
  }
  return parsed as HarFile;
}
