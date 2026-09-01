import type {
  CandidateRequest,
  ProjectScope,
  ScopeDecision,
} from "../types.js";

const SUPPORTED_PROTOCOLS = new Set(["http", "https"]);
const MAX_ENCODED_PATH_LENGTH = 8192;
const MAX_PATH_DECODE_PASSES = 16;

export interface ScopeEvaluationContext {
  rateAvailable?: boolean;
}

export function isRequestInScope(
  candidate: CandidateRequest,
  scope: ProjectScope | null | undefined,
  context: ScopeEvaluationContext = {},
): ScopeDecision {
  if (!validScope(scope))
    return deny(
      "NO_ACTIVE_SCOPE",
      "No active project scope is configured",
      null,
    );
  if (scope.stopConditions.manualStop)
    return deny(
      "MANUAL_STOP_ACTIVE",
      "Manual stop is active",
      "stopConditions.manualStop",
    );
  if (scope.stopConditions.authenticationLost)
    return deny(
      "AUTHENTICATION_LOST",
      "Authentication loss stop condition is active",
      "stopConditions.authenticationLost",
    );
  if (scope.stopConditions.repeatedServerErrors)
    return deny(
      "REPEATED_SERVER_ERRORS",
      "Repeated server errors stop condition is active",
      "stopConditions.repeatedServerErrors",
    );
  if (
    scope.stopConditions.maxRequestCount !== null &&
    scope.stopConditions.requestCount >= scope.stopConditions.maxRequestCount
  )
    return deny(
      "MAX_REQUEST_COUNT_REACHED",
      "Project request-count stop condition has been reached",
      "stopConditions.maxRequestCount",
    );
  if (context.rateAvailable === false)
    return deny(
      "RATE_LIMIT_EXHAUSTED",
      "Project request budget is exhausted for this minute",
      "maxRequestsPerMinute",
    );

  const canonical = canonicalizeCandidate(candidate.url);
  if (!canonical.ok) return canonical.decision;
  const method = candidate.method.trim().toUpperCase();
  if (
    !scope.allowedMethods.includes(
      method as ProjectScope["allowedMethods"][number],
    )
  )
    return deny(
      "METHOD_NOT_ALLOWED",
      `${method || "Empty method"} is not included in allowedMethods`,
      "allowedMethods",
    );
  if (!scope.allowedProtocols.includes(canonical.protocol))
    return deny(
      "PROTOCOL_NOT_ALLOWED",
      `${canonical.protocol} is not included in allowedProtocols`,
      "allowedProtocols",
    );
  const hosts = scope.allowedHosts.map(normalizeHost);
  if (!hosts.includes(canonical.host))
    return deny(
      "HOST_NOT_ALLOWED",
      `${canonical.host} is not included in allowedHosts`,
      "allowedHosts",
    );
  if (!scope.allowedPorts.includes(canonical.port))
    return deny(
      "PORT_NOT_ALLOWED",
      `Port ${canonical.port} is not included in allowedPorts`,
      "allowedPorts",
    );
  const excluded = scope.excludedPathPrefixes
    .map(normalizeConfiguredPath)
    .find((prefix) => pathMatches(canonical.path, prefix));
  if (excluded)
    return deny(
      "PATH_EXCLUDED",
      `${canonical.path} matches excluded path ${excluded}`,
      excluded,
    );
  const allowed = scope.allowedPathPrefixes
    .map(normalizeConfiguredPath)
    .find((prefix) => pathMatches(canonical.path, prefix));
  if (!allowed)
    return deny(
      "PATH_NOT_ALLOWED",
      `${canonical.path} is not included in allowedPathPrefixes`,
      "allowedPathPrefixes",
    );
  return {
    allowed: true,
    reasonCode: "IN_SCOPE",
    reason: "Candidate request matches the active project scope",
    matchedRule: allowed,
  };
}

export function evaluateRedirectTarget(
  method: string,
  redirectUrl: string,
  scope: ProjectScope | null | undefined,
  context: ScopeEvaluationContext = {},
): ScopeDecision {
  return isRequestInScope({ method, url: redirectUrl }, scope, context);
}

export class RequestBudget {
  private readonly consumed = new Map<string, number[]>();

  clear(): void {
    this.consumed.clear();
  }

  canConsumeRequest(scope: ProjectScope, now = Date.now()): boolean {
    this.prune(scope.id, now);
    return (
      (this.consumed.get(scope.id)?.length ?? 0) < scope.maxRequestsPerMinute
    );
  }

  consumeRequest(scope: ProjectScope, now = Date.now()): boolean {
    if (!this.canConsumeRequest(scope, now)) return false;
    const events = this.consumed.get(scope.id) ?? [];
    events.push(now);
    this.consumed.set(scope.id, events);
    return true;
  }

  restore(scopeId: string, timestamps: readonly number[]): void {
    this.consumed.set(
      scopeId,
      [...timestamps].sort((a, b) => a - b),
    );
  }

  snapshot(scopeId: string, now = Date.now()): number[] {
    this.prune(scopeId, now);
    return [...(this.consumed.get(scopeId) ?? [])];
  }

  private prune(scopeId: string, now: number): void {
    this.consumed.set(
      scopeId,
      (this.consumed.get(scopeId) ?? []).filter(
        (timestamp) => timestamp > now - 60_000,
      ),
    );
  }
}

function validScope(
  scope: ProjectScope | null | undefined,
): scope is ProjectScope {
  return Boolean(
    scope?.active &&
      scope.allowedHosts.length &&
      scope.allowedProtocols.length &&
      scope.allowedPorts.length &&
      scope.allowedPathPrefixes.length &&
      scope.allowedMethods.length &&
      Number.isInteger(scope.maxRequestsPerMinute) &&
      scope.maxRequestsPerMinute > 0,
  );
}

function canonicalizeCandidate(urlValue: string):
  | {
      ok: true;
      protocol: "http" | "https";
      host: string;
      port: number;
      path: string;
    }
  | { ok: false; decision: ScopeDecision } {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    return {
      ok: false,
      decision: deny(
        "MALFORMED_URL",
        "Candidate URL is malformed or ambiguous",
        null,
      ),
    };
  }
  if (url.username || url.password)
    return {
      ok: false,
      decision: deny(
        "USERINFO_NOT_ALLOWED",
        "Candidate URLs may not contain userinfo",
        "url.userinfo",
      ),
    };
  const protocol = url.protocol.slice(0, -1).toLowerCase();
  if (!SUPPORTED_PROTOCOLS.has(protocol))
    return {
      ok: false,
      decision: deny(
        "PROTOCOL_NOT_ALLOWED",
        `${protocol || "Unknown protocol"} is not supported`,
        "allowedProtocols",
      ),
    };
  let path: string;
  try {
    path = normalizePath(url.pathname);
  } catch {
    return {
      ok: false,
      decision: deny(
        "MALFORMED_URL",
        "Candidate path contains invalid encoding",
        null,
      ),
    };
  }
  return {
    ok: true,
    protocol: protocol as "http" | "https",
    host: normalizeHost(url.hostname),
    port: url.port ? Number(url.port) : protocol === "https" ? 443 : 80,
    path,
  };
}

function normalizeHost(value: string): string {
  const lower = value.trim().toLowerCase().replace(/\.$/, "");
  return lower.startsWith("[") && lower.endsWith("]")
    ? lower.slice(1, -1)
    : lower;
}

function normalizeConfiguredPath(value: string): string {
  if (!value.startsWith("/")) return "/__invalid_scope_path__";
  try {
    return normalizePath(value);
  } catch {
    return "/__invalid_scope_path__";
  }
}

function normalizePath(value: string): string {
  if (value.length > MAX_ENCODED_PATH_LENGTH)
    throw new Error("Candidate path is too long");
  let decoded = value;
  let stable = false;
  for (let index = 0; index < MAX_PATH_DECODE_PASSES; index += 1) {
    const next = decodeURIComponent(decoded);
    if (next === decoded) {
      stable = true;
      break;
    }
    decoded = next;
  }
  if (!stable) throw new Error("Candidate path encoding is too deeply nested");
  if (decoded.includes("\\") || decoded.includes("\0"))
    throw new Error("Ambiguous path");
  const segments: string[] = [];
  for (const segment of decoded.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return `/${segments.join("/")}${decoded.endsWith("/") && segments.length ? "/" : ""}`;
}

function pathMatches(path: string, prefix: string): boolean {
  if (prefix === "/") return true;
  if (prefix.endsWith("/"))
    return path === prefix.slice(0, -1) || path.startsWith(prefix);
  return path === prefix || path.startsWith(`${prefix}/`);
}

function deny(
  reasonCode: ScopeDecision["reasonCode"],
  reason: string,
  matchedRule: string | null,
): ScopeDecision {
  return { allowed: false, reasonCode, reason, matchedRule };
}
