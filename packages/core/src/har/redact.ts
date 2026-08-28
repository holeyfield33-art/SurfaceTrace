/**
 * Deterministic redaction of common secrets before any persistence.
 * Patterns are intentionally conservative; expand via sensitivity table later.
 */

const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "x-access-token",
  "x-csrf-token",
  "x-session-token",
]);

const SENSITIVE_QUERY_NAMES = new Set([
  "token",
  "access_token",
  "refresh_token",
  "api_key",
  "apikey",
  "key",
  "secret",
  "password",
  "passwd",
  "auth",
  "session",
  "sid",
]);

const REDACTED = "[REDACTED]";

export function isSensitiveHeader(name: string): boolean {
  return SENSITIVE_HEADER_NAMES.has(name.toLowerCase());
}

export function isSensitiveQueryParam(name: string): boolean {
  const lower = name.toLowerCase();
  if (SENSITIVE_QUERY_NAMES.has(lower)) return true;
  return lower.includes("token") || lower.includes("secret") || lower.includes("password");
}

export function redactHeaders(
  headers: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = isSensitiveHeader(k) ? REDACTED : v;
  }
  return out;
}

export function redactQueryParams(
  params: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    out[k] = isSensitiveQueryParam(k) ? REDACTED : v;
  }
  return out;
}

/**
 * Replace values of likely-sensitive JSON keys with [REDACTED].
 * Returns a shape string (keys + types), not full values, for storage.
 */
export function bodyShape(text: string | undefined | null): string | null {
  if (!text || text.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return JSON.stringify(shapeOf(parsed));
  } catch {
    // Non-JSON: return a size/type hint only
    return `[non-json length=${text.length}]`;
  }
}

function shapeOf(value: unknown): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    return [shapeOf(value[0])];
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      const lower = k.toLowerCase();
      if (
        lower.includes("password") ||
        lower.includes("secret") ||
        lower.includes("token") ||
        lower.includes("key") ||
        lower === "authorization"
      ) {
        out[k] = REDACTED;
      } else {
        out[k] = shapeOf(v);
      }
    }
    return out;
  }
  return typeof value;
}

export { REDACTED };
