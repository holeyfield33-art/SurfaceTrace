import { performance } from "node:perf_hooks";
import { redactBody, redactHeaders, sanitizeUrl } from "@surfacetrace/core";

export interface ReplayHttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

export interface ReplayHttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string | null;
  size: number;
  timingMs: number;
  redirectLocation: string | null;
  truncated: boolean;
}

export interface ReplayHttpOptions {
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export async function executeReplayRequest(
  request: ReplayHttpRequest,
  options: ReplayHttpOptions = {},
): Promise<ReplayHttpResponse> {
  const url = new URL(request.url);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("REPLAY_FAILED: unsupported protocol");
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxResponseBytes = options.maxResponseBytes ?? 1_048_576;
  const started = performance.now();
  let response: Response;
  try {
    response = await fetch(url, {
      method: request.method,
      headers: request.headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError")
      throw new Error("REPLAY_FAILED: timeout");
    throw new Error(
      `REPLAY_FAILED: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  if (response.body) {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxResponseBytes - size;
      if (value.length > remaining) {
        if (remaining > 0) chunks.push(value.slice(0, remaining));
        size += remaining;
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(value);
      size += value.length;
    }
  }
  const rawHeaders = Object.fromEntries(response.headers.entries());
  const rawBody = chunks.length
    ? new TextDecoder().decode(concat(chunks, size))
    : null;
  const location = response.headers.get("location");
  return {
    status: response.status,
    statusText: response.statusText,
    headers: redactHeaders(rawHeaders),
    body: redactBody(rawBody, response.headers.get("content-type") ?? ""),
    size,
    timingMs: Math.round((performance.now() - started) * 100) / 100,
    redirectLocation: location
      ? sanitizeUrl(new URL(location, url).toString())
      : null,
    truncated,
  };
}

function concat(chunks: Uint8Array[], size: number): Uint8Array {
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
