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
  "x-amz-security-token",
  "x-amz-session-token",
  "x-amz-credential",
  "x-amz-signature",
  "x-aws-ec2-metadata-token",
  "x-goog-api-key",
  "x-functions-key",
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
  "code",
  "authorization_code",
  "auth_code",
  "id_token",
  "client_secret",
  "credential",
  "credentials",
  "assertion",
  "samlresponse",
  "saml_response",
  "signature",
  "sig",
  "ticket",
  "passphrase",
  "private_key",
]);
const SENSITIVE_COMPACT_NAMES = new Set(
  [...SENSITIVE_QUERY_NAMES].map(normalizeName),
);

const REDACTED = "[REDACTED]";
const MAX_REDACTABLE_BODY_BYTES = 2 * 1024 * 1024;
const URL_VALUE_HEADERS = new Set([
  "content-location",
  "location",
  "referer",
  "referrer",
  "x-original-url",
  "x-rewrite-url",
]);
const SENSITIVE_TEXT_FIELD =
  "(?:access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|authorization[_-]?code|auth[_-]?code|api[_-]?key|private[_-]?key|password|passwd|passphrase|credential(?:s)?|authorization|session|secret|token|assertion|saml[_-]?response|signature|ticket|code)";

export function isSensitiveHeader(name: string): boolean {
  const lower = name.trim().toLowerCase();
  const compact = normalizeName(name);
  return (
    SENSITIVE_HEADER_NAMES.has(lower) ||
    compact.includes("token") ||
    compact.includes("credential") ||
    compact.endsWith("apikey") ||
    compact.endsWith("signature")
  );
}

export function isSensitiveQueryParam(name: string): boolean {
  const lower = name.toLowerCase();
  if (SENSITIVE_QUERY_NAMES.has(lower)) return true;
  const compact = normalizeName(name);
  if (SENSITIVE_COMPACT_NAMES.has(compact)) return true;
  return (
    compact.includes("token") ||
    compact.includes("secret") ||
    compact.includes("password") ||
    compact.includes("credential") ||
    compact.includes("passphrase") ||
    /^(?:api|access|private|secret|client|signing|encryption)key$/.test(
      compact,
    )
  );
}

export function redactHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = isSensitiveHeader(k) ? REDACTED : redactHeaderValue(k, v);
  }
  return out;
}

export function redactQueryParams(
  params: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    out[k] = isSensitiveQueryParam(k) ? REDACTED : v;
  }
  return out;
}

export function sanitizeUrl(raw: string): string {
  const url = new URL(raw);
  if (url.username) url.username = REDACTED;
  if (url.password) url.password = REDACTED;
  for (const name of [...url.searchParams.keys()]) {
    if (isSensitiveQueryParam(name)) url.searchParams.set(name, REDACTED);
  }
  if (url.hash.includes("=")) {
    const fragment = new URLSearchParams(url.hash.slice(1));
    let changed = false;
    for (const name of [...fragment.keys()]) {
      if (!isSensitiveQueryParam(name)) continue;
      fragment.set(name, REDACTED);
      changed = true;
    }
    if (changed) url.hash = fragment.toString();
  }
  return url.toString();
}

export function redactHarBody(
  text: string | undefined | null,
  mimeType = "",
  encoding?: string,
): string | null {
  if (!text || text.trim().length === 0) return null;
  if (encoding && !mimeType.trim())
    return `[encoded body omitted length=${text.length}]`;
  if (!isTextualMimeType(mimeType))
    return `[binary body omitted length=${text.length}]`;
  if (!encoding) return redactBody(text, mimeType);
  if (encoding.trim().toLowerCase() !== "base64")
    return `[encoded body omitted length=${text.length}]`;
  const decoded = decodeBase64Text(text);
  if (decoded === null)
    return `[invalid base64 body omitted length=${text.length}]`;
  return redactBody(decoded, mimeType);
}

export function redactBody(
  text: string | undefined | null,
  mimeType = "",
): string | null {
  if (!text || text.trim().length === 0) return null;
  if (Buffer.byteLength(text, "utf8") > MAX_REDACTABLE_BODY_BYTES)
    return `[body omitted length=${text.length}]`;
  const lowerMimeType = mimeType.toLowerCase();
  if (lowerMimeType.includes("multipart/form-data"))
    return "[multipart body omitted]";
  if (lowerMimeType.includes("json")) {
    try {
      return JSON.stringify(redactValue(JSON.parse(text) as unknown), null, 2);
    } catch {
      return redactTextSecrets(text);
    }
  }
  if (lowerMimeType.includes("x-www-form-urlencoded")) {
    const params = new URLSearchParams(text);
    for (const name of [...params.keys()])
      if (isSensitiveQueryParam(name)) params.set(name, REDACTED);
    return params.toString();
  }
  return redactTextSecrets(text);
}

function redactTextSecrets(text: string): string {
  let safe = text.replace(
    /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/gi,
    REDACTED,
  );
  safe = safe.replace(
    new RegExp(
      `(<${SENSITIVE_TEXT_FIELD}\\b[^>]*>)[\\s\\S]*?(<\\/${SENSITIVE_TEXT_FIELD}\\s*>)`,
      "gi",
    ),
    `$1${REDACTED}$2`,
  );
  safe = safe.replace(
    new RegExp(
      `(\\b${SENSITIVE_TEXT_FIELD}\\b\\s*[=:]\\s*)(["'])([\\s\\S]*?)\\2`,
      "gi",
    ),
    (_match, prefix: string, quote: string) =>
      `${prefix}${quote}${REDACTED}${quote}`,
  );
  safe = safe.replace(
    new RegExp(
      `(\\b${SENSITIVE_TEXT_FIELD}\\b\\s*[=:]\\s*)([^&\\s,;}\\]]+)`,
      "gi",
    ),
    `$1${REDACTED}`,
  );
  safe = safe.replace(
    /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi,
    `$1 ${REDACTED}`,
  );
  safe = safe.replace(
    /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
    REDACTED,
  );
  safe = safe.replace(
    /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\b(?:ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{12,}\b/g,
    REDACTED,
  );
  return safe;
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (typeof value === "string") return redactTextSecrets(value);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      isSensitiveQueryParam(key) || key.toLowerCase() === "authorization"
        ? REDACTED
        : redactValue(child),
    ]),
  );
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
      if (isSensitiveQueryParam(lower) || lower === "authorization") {
        out[k] = REDACTED;
      } else {
        out[k] = shapeOf(v);
      }
    }
    return out;
  }
  return typeof value;
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function redactHeaderValue(name: string, value: string): string {
  const textRedacted = redactTextSecrets(value);
  if (!URL_VALUE_HEADERS.has(name.trim().toLowerCase())) return textRedacted;
  try {
    const absolute = /^[a-z][a-z0-9+.-]*:/i.test(value);
    const protocolRelative = value.startsWith("//");
    const parsed = new URL(value, "https://surfacetrace.invalid");
    const sanitized = new URL(sanitizeUrl(parsed.toString()));
    if (absolute) return sanitized.toString();
    if (protocolRelative)
      return `//${sanitized.host}${sanitized.pathname}${sanitized.search}${sanitized.hash}`;
    return `${sanitized.pathname}${sanitized.search}${sanitized.hash}`;
  } catch {
    return textRedacted;
  }
}

function isTextualMimeType(mimeType: string): boolean {
  const lower = mimeType.toLowerCase();
  if (!lower) return true;
  return (
    lower.startsWith("text/") ||
    lower.includes("json") ||
    lower.includes("xml") ||
    lower.includes("javascript") ||
    lower.includes("graphql") ||
    lower.includes("x-www-form-urlencoded") ||
    lower.includes("multipart/form-data")
  );
}

function decodeBase64Text(value: string): string | null {
  const compact = value.replace(/\s/g, "");
  if (
    !compact ||
    compact.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)
  )
    return null;
  const unpadded = compact.replace(/=+$/, "");
  const padded = unpadded.padEnd(Math.ceil(unpadded.length / 4) * 4, "=");
  const bytes = Buffer.from(padded, "base64");
  if (
    bytes.length > MAX_REDACTABLE_BODY_BYTES ||
    bytes.toString("base64").replace(/=+$/, "") !== unpadded
  )
    return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export { REDACTED };
