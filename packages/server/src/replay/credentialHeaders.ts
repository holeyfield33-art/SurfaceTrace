import { REDACTED } from "@surfacetrace/core";

const HTTP_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const COOKIE_VALUE = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/;
const forbidden = new Set([
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "upgrade",
  "keep-alive",
  "trailer",
  "te",
  "proxy-authorization",
  "proxy-authenticate",
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
  "via",
]);

function safeName(name: string): string {
  if (!HTTP_TOKEN.test(name) || name.includes("\r") || name.includes("\n"))
    throw new Error(`Credential header rejected: ${JSON.stringify(name)}`);
  const normalized = name.toLowerCase();
  if (
    name.startsWith(":") ||
    forbidden.has(normalized) ||
    normalized.startsWith("proxy-")
  )
    throw new Error(`Credential header rejected: ${name}`);
  return normalized;
}

function safeValue(name: string, value: string): void {
  if (typeof value !== "string" || /[\r\n]/.test(value))
    throw new Error(`Credential header rejected: ${name}`);
}

export function validateApprovedApiKeyHeaders(names: string[] = []): Set<string> {
  const approved = new Set<string>();
  for (const name of names) {
    const normalized = safeName(name);
    if (normalized === "authorization")
      throw new Error(`Credential header rejected: ${name}`);
    if (approved.has(normalized))
      throw new Error(`Duplicate credential header rejected: ${name}`);
    approved.add(normalized);
  }
  return approved;
}

export function validateRuntimeCredentialHeaders(
  headers: Record<string, string>,
  approvedApiKeyHeaderNames: string[] = [],
): Record<string, string> {
  const approved = validateApprovedApiKeyHeaders(approvedApiKeyHeaderNames);
  const seen = new Set<string>();
  for (const [name, value] of Object.entries(headers)) {
    const normalized = safeName(name);
    safeValue(name, value);
    if (seen.has(normalized))
      throw new Error(`Duplicate credential header rejected: ${name}`);
    seen.add(normalized);
    if (normalized !== "authorization" && !approved.has(normalized))
      throw new Error(`Credential header is not approved: ${name}`);
  }
  return structuredClone(headers);
}

export function validateRuntimeCredentialCookies(
  cookies: Record<string, string>,
): Record<string, string> {
  for (const [name, value] of Object.entries(cookies)) {
    if (!HTTP_TOKEN.test(name) || !COOKIE_VALUE.test(value))
      throw new Error(`Runtime cookie rejected: ${JSON.stringify(name)}`);
  }
  return structuredClone(cookies);
}

export function mergeRuntimeCredentialHeaders(
  base: Record<string, string>,
  credentials: Record<string, string>,
  approvedApiKeyHeaderNames: string[] = [],
): Record<string, string> {
  const validated = validateRuntimeCredentialHeaders(
    credentials,
    approvedApiKeyHeaderNames,
  );
  const merged = { ...base };
  for (const [name, value] of Object.entries(validated)) {
    const existing = Object.keys(merged).find(
      (candidate) => candidate.toLowerCase() === name.toLowerCase(),
    );
    if (existing && !merged[existing]!.includes(REDACTED))
      throw new Error(`Credential header cannot override request header: ${name}`);
    if (existing) delete merged[existing];
    merged[name] = value;
  }
  return merged;
}

export function validateOutboundHeaders(headers: Record<string, string>): void {
  const seen = new Set<string>();
  for (const [name, value] of Object.entries(headers)) {
    const normalized = safeName(name);
    safeValue(name, value);
    if (seen.has(normalized))
      throw new Error(`Duplicate credential header rejected: ${name}`);
    seen.add(normalized);
  }
}
