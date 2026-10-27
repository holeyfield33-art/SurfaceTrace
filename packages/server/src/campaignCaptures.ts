import { createHmac, createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { importHar, parseHarJson, redactBody } from "@surfacetrace/core";
import type { Observation } from "@surfacetrace/core";
import type { HarEntry } from "@surfacetrace/core";

export type CaptureIdentity = "ACCOUNT_A" | "ACCOUNT_B" | "ANONYMOUS" | "UNASSIGNED";
export type RequestAuthState = "PRESENT" | "NONE";
export type IdentityConsistency = "CONFIRMED_SINGLE_IDENTITY" | "SESSION_ROTATION" | "POSSIBLE_MIXED_IDENTITY" | "UNKNOWN";
export type ObservationClassification = "PUBLIC_INFORMATIONAL" | "ACCOUNT_SPECIFIC" | "AUTHENTICATED_PRIVATE_DATA" | "STATE_CHANGING" | "IDENTITY_SESSION" | "TOKEN_CREDENTIAL" | "OBJECT_OWNERSHIP_CANDIDATE" | "UNKNOWN";

export interface CaptureObservation extends Observation {
  captureId: string;
  captureIdentity: CaptureIdentity;
  requestAuthState: RequestAuthState;
  authFingerprints: string[];
  tokenFingerprints: string[];
  sequence: number;
  classification: ObservationClassification;
}

export interface CaptureRecord {
  id: string;
  campaignId: string;
  captureIdentity: CaptureIdentity;
  sourceFilename: string;
  description: string;
  importedAt: string;
  capturedAt: string | null;
  rawPath: string;
  rawReference: string;
  rawSha256: string;
  observationCount: number;
  endpointCount: number;
  authFingerprints: string[];
  tokenFingerprints: string[];
  identityConsistency: IdentityConsistency;
  warnings: string[];
}

export interface OwnershipRelationship {
  id: string;
  campaignId: string;
  identity: CaptureIdentity;
  relation: "OWNS" | "USES";
  objectType: string;
  objectFingerprint: string;
  confidence: "CONFIRMED" | "PROBABLE";
  evidenceObservationId: string;
  createdAt: string;
}

export interface CampaignIdentityRecord {
  id: CaptureIdentity;
  alias: string;
  campaignId: string;
  researcherControlled: boolean | null;
  createdAt: string;
  notes: string;
  verificationStatus: "VERIFIED" | "UNVERIFIED";
  verificationEvidenceObservationIds: string[];
  sessionFingerprints: string[];
  tokenFingerprints: string[];
  knownOwnedObjectRelationshipIds: string[];
  associatedCaptureIds: string[];
}

export interface CampaignComparison {
  id: string;
  campaignId: string;
  endpointId: string;
  baselineObservationId: string;
  resultObservationId: string;
  changedInput: string;
  baselineValueClass: string;
  proposedValueClass: string;
  expectedPolicy: string;
  authorization: string;
  stopCondition: string;
  resultSummary: string;
  conclusion: "INCONCLUSIVE" | "CONFIRMED_BOUNDARY" | "POTENTIAL_FINDING";
  createdAt: string;
  previousHash: string | null;
  evidenceHash: string;
}

interface DerivedCapture {
  record: CaptureRecord;
  observations: CaptureObservation[];
  endpoints: ReturnType<typeof importHar>["endpoints"];
  inputs: ReturnType<typeof importHar>["inputs"];
}

/**
 * Per-campaign intake settings. Everything target-specific lives here so one install can
 * ingest HARs for any program. Pattern fields are case-insensitive regex sources.
 */
export interface CaptureProfile {
  /** Hosts (exact or `*.suffix`) whose requests are scanned for credentials. Empty = every host. */
  credentialHosts: string[];
  /** Cookie names treated as session/auth credentials. */
  authCookiePattern: string;
  /** Response JSON keys treated as issued tokens. */
  tokenFieldPattern: string;
  /** URL paths whose JSON response identifies the signed-in person. */
  profilePaths: string[];
  /** Keys inside the response (`data.result`, `data.profile`, or top level) holding a stable person id, in priority order. */
  profileIdFields: string[];
  /** Hosts that are out of scope for the program; shown as explicitly ineligible in the UI. */
  excludedHosts: string[];
  /** Extra credential names scrubbed from free-text notes (cookie names are always included). */
  extraRedactNames: string[];
  /** Short note about where the scope came from, shown beside excluded hosts. */
  scopeNote: string;
}

export const DEFAULT_CAPTURE_PROFILE: CaptureProfile = {
  credentialHosts: [],
  authCookiePattern: "session|token|auth|jwt|identity|^sid$|^sess$",
  tokenFieldPattern: "^(?:jwt|refresh_?token|access_?token|id_?token|token_?identifier)$",
  profilePaths: ["/api/v1/profile", "/api/validate/user", "/api/me", "/api/v1/me", "/api/user", "/api/v1/user", "/me", "/profile"],
  profileIdFields: ["email", "uuid", "id", "userId", "user_id", "sub"],
  excludedHosts: [],
  extraRedactNames: [],
  scopeNote: "",
};

const IDENTITIES: CaptureIdentity[] = ["ACCOUNT_A", "ACCOUNT_B", "ANONYMOUS", "UNASSIGNED"];

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function cleanList(value: unknown, itemLength: number, maxItems: number, transform: (item: string) => string = (item) => item): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string")
    .map((item) => transform(item.trim())).filter((item) => item && item.length <= itemLength))].slice(0, maxItems);
}

function cleanPattern(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 300) return fallback;
  try { new RegExp(value, "i"); return value; } catch { return fallback; }
}

/** Validates untrusted profile input; anything invalid falls back to the generic default. */
export function normalizeCaptureProfile(input: unknown): CaptureProfile {
  const source = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const host = (item: string) => item.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return {
    credentialHosts: cleanList(source.credentialHosts, 253, 100, host),
    authCookiePattern: cleanPattern(source.authCookiePattern, DEFAULT_CAPTURE_PROFILE.authCookiePattern),
    tokenFieldPattern: cleanPattern(source.tokenFieldPattern, DEFAULT_CAPTURE_PROFILE.tokenFieldPattern),
    profilePaths: source.profilePaths === undefined ? DEFAULT_CAPTURE_PROFILE.profilePaths
      : cleanList(source.profilePaths, 200, 50, (item) => (item.startsWith("/") ? item : `/${item}`)),
    profileIdFields: source.profileIdFields === undefined ? DEFAULT_CAPTURE_PROFILE.profileIdFields : cleanList(source.profileIdFields, 80, 20),
    excludedHosts: cleanList(source.excludedHosts, 253, 200, host),
    extraRedactNames: cleanList(source.extraRedactNames, 80, 50),
    scopeNote: typeof source.scopeNote === "string" ? source.scopeNote.slice(0, 500) : "",
  };
}

function hostMatches(host: string, patterns: string[]): boolean {
  if (!patterns.length) return true;
  const lower = host.toLowerCase();
  return patterns.some((pattern) => pattern.startsWith("*.")
    ? lower === pattern.slice(2) || lower.endsWith(pattern.slice(1))
    : lower === pattern);
}

interface CompiledProfile {
  profile: CaptureProfile;
  authCookie: RegExp;
  tokenField: RegExp;
  extraRedact: RegExp | null;
}

function compileProfile(profile: CaptureProfile): CompiledProfile {
  return {
    profile,
    authCookie: new RegExp(profile.authCookiePattern, "i"),
    tokenField: new RegExp(profile.tokenFieldPattern, "i"),
    extraRedact: profile.extraRedactNames.length
      ? new RegExp(`\\b(?:${profile.extraRedactNames.map(escapeRegex).join("|")})\\s*=\\s*[^\\s;,]+`, "gi") : null,
  };
}

export function validCaptureIdentity(value: string): value is CaptureIdentity {
  return IDENTITIES.includes(value as CaptureIdentity);
}

export class CampaignCaptureVault {
  readonly root: string;
  private readonly key: Buffer;

  constructor(root: string) {
    this.root = resolve(root);
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const keyPath = join(this.root, ".fingerprint-key");
    if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32), { flag: "wx", mode: 0o600 });
    this.key = readFileSync(keyPath);
  }

  private fingerprint(value: string): string {
    return createHmac("sha256", this.key).update(value).digest("hex").slice(0, 24);
  }

  private directory(projectId: string, captureId: string): string {
    if (!/^[a-f0-9-]{36}$/i.test(projectId) || !/^[a-f0-9-]{36}$/i.test(captureId))
      throw new Error("Invalid project or capture ID");
    return join(this.root, projectId, captureId);
  }

  private reference(path: string): string {
    const local = relative(resolve(process.cwd(), "../.."), path).replace(/\\/g, "/");
    return local.startsWith("..") ? path : local;
  }

  profile(projectId: string): CaptureProfile {
    this.directory(projectId, "00000000-0000-0000-0000-000000000000");
    const path = join(this.root, projectId, "profile.json");
    if (!existsSync(path)) return { ...DEFAULT_CAPTURE_PROFILE };
    try { return normalizeCaptureProfile(JSON.parse(readFileSync(path, "utf8"))); }
    catch { return { ...DEFAULT_CAPTURE_PROFILE }; }
  }

  setProfile(projectId: string, input: unknown): CaptureProfile {
    const profile = normalizeCaptureProfile(input);
    mkdirSync(join(this.root, projectId), { recursive: true, mode: 0o700 });
    writeFileSync(join(this.root, projectId, "profile.json"), JSON.stringify(profile), { mode: 0o600 });
    return profile;
  }

  private credentials(entry: HarEntry, host: string, { profile, authCookie: AUTH_COOKIE }: CompiledProfile): string[] {
    if (!hostMatches(host, profile.credentialHosts)) return [];
    const found: string[] = [];
    for (const header of entry.request.headers ?? []) {
      if (header.name.toLowerCase() === "authorization" && header.value.trim())
        found.push(`authorization:${this.fingerprint(header.value.trim())}`);
      if (header.name.toLowerCase() === "cookie")
        for (const piece of header.value.split(";")) {
          const separator = piece.indexOf("=");
          if (separator < 1) continue;
          const name = piece.slice(0, separator).trim();
          const value = piece.slice(separator + 1).trim();
          if (AUTH_COOKIE.test(name) && value.length >= 8 && value !== "[REDACTED]")
            found.push(`${name.toLowerCase()}:${this.fingerprint(value)}`);
        }
    }
    for (const cookie of entry.request.cookies ?? [])
      if (AUTH_COOKIE.test(cookie.name) && cookie.value?.length >= 8 && cookie.value !== "[REDACTED]")
        found.push(`${cookie.name.toLowerCase()}:${this.fingerprint(cookie.value)}`);
    return [...new Set(found)].sort();
  }

  private responseTokens(entry: HarEntry, { tokenField }: CompiledProfile): string[] {
    try {
      const body = JSON.parse(entry.response.content?.text ?? "") as unknown;
      const found: string[] = [];
      const walk = (value: unknown, depth: number): void => {
        if (!value || typeof value !== "object" || depth > 5) return;
        for (const [name, child] of Object.entries(value)) {
          if (tokenField.test(name) && typeof child === "string" && child && child !== "[REDACTED]")
            found.push(`${name.toLowerCase()}:${this.fingerprint(child)}`);
          else walk(child, depth + 1);
        }
      };
      walk(body, 0);
      return [...new Set(found)].sort();
    } catch { return []; }
  }

  private profileMarker(entry: HarEntry, { profile }: CompiledProfile): string | null {
    let path: string;
    try { path = new URL(entry.request.url).pathname; } catch { return null; }
    if (!profile.profilePaths.includes(path)) return null;
    try {
      const body = JSON.parse(entry.response.content?.text ?? "") as { data?: { result?: Record<string, unknown>; profile?: Record<string, unknown> } } & Record<string, unknown>;
      const person = (body.data?.result ?? body.data?.profile ?? body.data ?? body) as Record<string, unknown>;
      for (const field of profile.profileIdFields) {
        const value = person?.[field];
        if (typeof value === "string" && value) return this.fingerprint(value);
        if (typeof value === "number") return this.fingerprint(String(value));
      }
      return null;
    } catch { return null; }
  }

  import(projectId: string, raw: Buffer, identity: CaptureIdentity, filename: string, description = ""): CaptureRecord {
    const har = parseHarJson(raw.toString("utf8"));
    const derived = importHar(har);
    const compiled = compileProfile(this.profile(projectId));
    const id = randomUUID();
    const directory = this.directory(projectId, id);
    const rawPath = join(directory, "raw.har");
    const fingerprints = new Set<string>();
    const tokenFingerprints = new Set<string>();
    const personMarkers = new Set<string>();
    const authByEntry = new Map<number, string[]>();
    const tokensByEntry = new Map<number, string[]>();
    for (const [sequence, entry] of har.log.entries.entries()) {
      let host = "";
      try { host = new URL(entry.request.url).hostname; } catch { continue; }
      const credentials = this.credentials(entry, host, compiled);
      authByEntry.set(sequence, credentials);
      const tokens = this.responseTokens(entry, compiled);
      tokensByEntry.set(sequence, tokens);
      tokens.forEach((value) => tokenFingerprints.add(value));
      credentials.forEach((value) => fingerprints.add(value));
      const marker = this.profileMarker(entry, compiled);
      if (marker) personMarkers.add(marker);
    }
    const observations: CaptureObservation[] = derived.observations.map((observation, index) => {
      const sequence = derived.sourceEntryIndices?.[index] ?? index;
      const credentials = authByEntry.get(sequence) ?? [];
      const safeUrl = new URL(observation.url);
      for (const name of safeUrl.searchParams.keys()) safeUrl.searchParams.set(name, "[REDACTED]");
      const safeHeaders = (headers: Record<string, string>) => Object.fromEntries(
        Object.entries(headers).map(([name, value]) => [name, /^(content-type|accept)$/i.test(name) ? value : "[REDACTED]"]),
      );
      return {
        ...observation,
        url: safeUrl.toString(),
        requestHeaders: safeHeaders(observation.requestHeaders),
        responseHeaders: safeHeaders(observation.responseHeaders),
        http: {
          request: {
            ...observation.http.request,
            target: safeUrl.pathname + safeUrl.search,
            headers: safeHeaders(observation.http.request.headers),
            cookies: Object.fromEntries(Object.keys(observation.http.request.cookies).map((name) => [name, "[REDACTED]"])),
            query: Object.fromEntries(Object.keys(observation.http.request.query).map((name) => [name, "[REDACTED]"])),
            body: null,
          },
          response: { ...observation.http.response, headers: safeHeaders(observation.http.response.headers), body: null },
        },
        id: `${id}:${observation.id}:${sequence}`,
        captureId: id,
        captureIdentity: identity,
        requestAuthState: credentials.length ? "PRESENT" : "NONE",
        authFingerprints: credentials,
        tokenFingerprints: tokensByEntry.get(sequence) ?? [],
        sequence,
        classification: "UNKNOWN",
      };
    });
    const variantsByCredentialName = new Map<string, Set<string>>();
    for (const value of fingerprints) {
      const name = value.split(":", 1)[0]!;
      const variants = variantsByCredentialName.get(name) ?? new Set<string>();
      variants.add(value);
      variantsByCredentialName.set(name, variants);
    }
    const rotated = [...variantsByCredentialName.values()].some((values) => values.size > 1);
    const identityConsistency: IdentityConsistency = personMarkers.size > 1
      ? "POSSIBLE_MIXED_IDENTITY"
      : personMarkers.size === 1 && rotated
        ? "SESSION_ROTATION"
        : personMarkers.size === 1 ? "CONFIRMED_SINGLE_IDENTITY" : "UNKNOWN";
    const warnings = identityConsistency === "POSSIBLE_MIXED_IDENTITY"
      ? ["Multiple account profile markers detected. Review and reassign observations before A/B comparison."]
      : identityConsistency === "UNKNOWN" ? ["No profile marker detected; capture ownership is unverified."] : [];
    const record: CaptureRecord = {
      id, campaignId: projectId, captureIdentity: identity,
      sourceFilename: basename(filename).slice(0, 255), description: description.slice(0, 1000),
      importedAt: new Date().toISOString(),
      capturedAt: har.log.entries[0]?.startedDateTime ?? null,
      rawPath, rawReference: this.reference(rawPath),
      rawSha256: createHash("sha256").update(raw).digest("hex"),
      observationCount: observations.length, endpointCount: derived.endpoints.length,
      authFingerprints: [...fingerprints].sort(), tokenFingerprints: [...tokenFingerprints].sort(), identityConsistency, warnings,
    };
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(rawPath, raw, { flag: "wx", mode: 0o400 });
    writeFileSync(join(directory, "derived.json"), JSON.stringify({ record, observations, endpoints: derived.endpoints, inputs: derived.inputs } satisfies DerivedCapture), { flag: "wx", mode: 0o600 });
    return record;
  }

  list(projectId: string): DerivedCapture[] {
    const projectDirectory = join(this.root, projectId);
    if (!existsSync(projectDirectory)) return [];
    return readdirSync(projectDirectory).flatMap((id) => {
      const path = join(projectDirectory, id, "derived.json");
      if (!existsSync(path)) return [];
      const original = readFileSync(path, "utf8");
      const capture = JSON.parse(original) as DerivedCapture;
      let changed = !capture.record.rawReference;
      capture.record.rawReference ??= this.reference(capture.record.rawPath);
      const { authCookie } = compileProfile(this.profile(projectId));
      const retain = (value: string) => value.startsWith("authorization:") || authCookie.test(value.split(":", 1)[0]!);
      capture.record.authFingerprints = capture.record.authFingerprints.filter(retain);
      for (const observation of capture.observations) {
        const previous = observation.authFingerprints.length;
        observation.authFingerprints = observation.authFingerprints.filter(retain);
        changed ||= previous !== observation.authFingerprints.length;
        observation.requestAuthState = observation.authFingerprints.length ? "PRESENT" : "NONE";
        observation.classification ??= "UNKNOWN";
      }
      if (changed) writeFileSync(path, JSON.stringify(capture), { mode: 0o600 });
      return [capture];
    });
  }

  archived(projectId: string): CaptureRecord[] {
    const archiveRoot = join(this.root, ".trash", projectId);
    if (!existsSync(archiveRoot)) return [];
    return readdirSync(archiveRoot).flatMap((id) => {
      const path = join(archiveRoot, id, "derived.json");
      return existsSync(path) ? [(JSON.parse(readFileSync(path, "utf8")) as DerivedCapture).record] : [];
    });
  }

  archive(projectId: string, captureId: string): void {
    const source = this.directory(projectId, captureId);
    if (!existsSync(join(source, "derived.json"))) throw new Error("Capture not found");
    const references = new Set((JSON.parse(readFileSync(join(source, "derived.json"), "utf8")) as DerivedCapture)
      .observations.map((observation) => observation.id));
    if (this.relationships(projectId).some((item) => references.has(item.evidenceObservationId)) ||
        this.comparisons(projectId).some((item) => references.has(item.baselineObservationId) || references.has(item.resultObservationId)))
      throw new Error("Capture has saved evidence; remove or export those records before archiving");
    const target = join(this.root, ".trash", projectId, captureId);
    mkdirSync(join(this.root, ".trash", projectId), { recursive: true, mode: 0o700 });
    if (existsSync(target)) throw new Error("Capture is already archived");
    renameSync(source, target);
  }

  restore(projectId: string, captureId: string): void {
    const target = this.directory(projectId, captureId);
    const source = join(this.root, ".trash", projectId, captureId);
    if (!existsSync(join(source, "derived.json"))) throw new Error("Archived capture not found");
    if (existsSync(target)) throw new Error("Capture already exists");
    mkdirSync(join(this.root, projectId), { recursive: true, mode: 0o700 });
    renameSync(source, target);
  }

  deleteArchived(projectId: string, captureId: string): void {
    this.directory(projectId, captureId);
    const target = join(this.root, ".trash", projectId, captureId);
    if (!existsSync(join(target, "derived.json"))) throw new Error("Archived capture not found");
    rmSync(target, { recursive: true });
  }

  relationships(projectId: string): OwnershipRelationship[] {
    const path = join(this.root, projectId, "relationships.json");
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as OwnershipRelationship[] : [];
  }

  comparisons(projectId: string): CampaignComparison[] {
    const path = join(this.root, projectId, "comparisons.json");
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as CampaignComparison[] : [];
  }

  addComparison(projectId: string, input: Omit<CampaignComparison, "id" | "campaignId" | "endpointId" | "createdAt" | "previousHash" | "evidenceHash">): CampaignComparison {
    const observations = this.list(projectId).flatMap((item) => item.observations);
    const baseline = observations.find((item) => item.id === input.baselineObservationId);
    const result = observations.find((item) => item.id === input.resultObservationId);
    if (!baseline || !result || baseline.id === result.id || baseline.endpointId !== result.endpointId ||
        !["ACCOUNT_A", "ACCOUNT_B"].includes(baseline.captureIdentity) ||
        !["ACCOUNT_A", "ACCOUNT_B"].includes(result.captureIdentity) ||
        baseline.captureIdentity === result.captureIdentity || !input.changedInput.trim() || !input.expectedPolicy.trim())
      throw new Error("Comparison needs same-endpoint observations from both controlled identities");
    const previous = this.comparisons(projectId);
    const { extraRedact } = compileProfile(this.profile(projectId));
    const safeNote = (value: string, length: number) => (redactBody(value.slice(0, length), "text/plain") ?? "")
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
      .replace(/\b(?:session(?:id)?|sid|auth(?:orization)?|token|jwt|[\w-]*(?:session|token|auth)[\w-]*)\s*=\s*[^\s;,]+/gi, "[REDACTED_CREDENTIAL]")
      .replace(extraRedact ?? /$^/, "[REDACTED_CREDENTIAL]")
      .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]");
    const payload = {
      id: randomUUID(), campaignId: projectId, endpointId: baseline.endpointId,
      baselineObservationId: baseline.id, resultObservationId: result.id,
      changedInput: safeNote(input.changedInput, 200),
      baselineValueClass: safeNote(input.baselineValueClass, 200),
      proposedValueClass: safeNote(input.proposedValueClass, 200),
      expectedPolicy: safeNote(input.expectedPolicy, 1000),
      authorization: safeNote(input.authorization, 1000),
      stopCondition: safeNote(input.stopCondition, 1000),
      resultSummary: safeNote(input.resultSummary, 2000),
      conclusion: input.conclusion, createdAt: new Date().toISOString(),
      previousHash: previous.at(-1)?.evidenceHash ?? null,
    };
    const record: CampaignComparison = { ...payload, evidenceHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex") };
    writeFileSync(join(this.root, projectId, "comparisons.json"), JSON.stringify([...previous, record]), { mode: 0o600 });
    return record;
  }

  identities(projectId: string): CampaignIdentityRecord[] {
    const path = join(this.root, projectId, "identities.json");
    const captures = this.list(projectId);
    const stored = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as CampaignIdentityRecord[] : [];
    const relationships = this.relationships(projectId);
    const records = IDENTITIES.map((id) => {
      const old = stored.find((item) => item.id === id);
      const ownedCaptures = captures.filter((item) => item.record.captureIdentity === id);
      const validEvidence = (old?.verificationEvidenceObservationIds ?? []).filter((evidenceId) =>
        captures.some((capture) => capture.observations.some((observation) => observation.id === evidenceId && observation.captureIdentity === id)),
      );
      return {
        id, alias: old?.alias ?? id.replace("_", " "), campaignId: projectId,
        researcherControlled: id === "ACCOUNT_A" || id === "ACCOUNT_B" ? true : id === "ANONYMOUS" ? false : null,
        createdAt: old?.createdAt ?? new Date().toISOString(), notes: old?.notes ?? "",
        verificationStatus: validEvidence.length ? "VERIFIED" : "UNVERIFIED",
        verificationEvidenceObservationIds: validEvidence,
        sessionFingerprints: [...new Set(ownedCaptures.flatMap((item) => item.record.authFingerprints))].sort(),
        tokenFingerprints: [...new Set(ownedCaptures.flatMap((item) => item.record.tokenFingerprints ?? []))].sort(),
        knownOwnedObjectRelationshipIds: relationships.filter((item) => item.identity === id).map((item) => item.id),
        associatedCaptureIds: ownedCaptures.map((item) => item.record.id),
      } satisfies CampaignIdentityRecord;
    });
    if (!existsSync(path)) writeFileSync(path, JSON.stringify(records), { mode: 0o600 });
    return records;
  }

  updateIdentity(projectId: string, identity: CaptureIdentity, notes: string, evidenceObservationId?: string): CampaignIdentityRecord {
    const identities = this.identities(projectId);
    const record = identities.find((item) => item.id === identity)!;
    const { profilePaths } = this.profile(projectId);
    if (evidenceObservationId) {
      const observation = this.list(projectId).flatMap((item) => item.observations)
        .find((item) => item.id === evidenceObservationId);
      if (!observation || observation.captureIdentity !== identity ||
          observation.requestAuthState !== "PRESENT" ||
          !profilePaths.includes(observation.pathTemplate))
        throw new Error("Identity verification requires matching capture evidence");
      record.verificationStatus = "VERIFIED";
      record.verificationEvidenceObservationIds = [...new Set([...record.verificationEvidenceObservationIds, evidenceObservationId])];
    }
    record.notes = notes.slice(0, 1000);
    writeFileSync(join(this.root, projectId, "identities.json"), JSON.stringify(identities), { mode: 0o600 });
    return record;
  }

  verifyRaw(projectId: string, captureId: string): { intact: boolean; expectedSha256: string; observedSha256: string } {
    const capture = this.list(projectId).find((item) => item.record.id === captureId);
    if (!capture) throw new Error("Capture not found");
    const observedSha256 = createHash("sha256").update(readFileSync(capture.record.rawPath)).digest("hex");
    return { intact: observedSha256 === capture.record.rawSha256, expectedSha256: capture.record.rawSha256, observedSha256 };
  }

  addRelationship(
    projectId: string,
    input: { identity: CaptureIdentity; relation: "OWNS" | "USES"; objectType: string; objectValue: string; confidence: "CONFIRMED" | "PROBABLE"; evidenceObservationId: string },
  ): OwnershipRelationship {
    const observation = this.list(projectId).flatMap((item) => item.observations)
      .find((item) => item.id === input.evidenceObservationId);
    if (!observation || observation.captureIdentity !== input.identity ||
        !["ACCOUNT_A", "ACCOUNT_B"].includes(input.identity) ||
        !input.objectValue.trim() || !input.objectType.trim())
      throw new Error("Owned-object relationship requires matching captured evidence");
    const record: OwnershipRelationship = {
      id: randomUUID(), campaignId: projectId, identity: input.identity,
      relation: input.relation, objectType: input.objectType.trim().slice(0, 80),
      objectFingerprint: this.fingerprint(input.objectValue.trim()),
      confidence: input.confidence, evidenceObservationId: observation.id,
      createdAt: new Date().toISOString(),
    };
    const path = join(this.root, projectId, "relationships.json");
    writeFileSync(path, JSON.stringify([...this.relationships(projectId), record]), { mode: 0o600 });
    return record;
  }

  reassign(projectId: string, captureId: string, identity: CaptureIdentity, sequence?: number): CaptureRecord {
    const path = join(this.directory(projectId, captureId), "derived.json");
    const capture = JSON.parse(readFileSync(path, "utf8")) as DerivedCapture;
    if (sequence === undefined) {
      capture.record.captureIdentity = identity;
      capture.observations.forEach((observation) => { observation.captureIdentity = identity; });
    } else {
      const observation = capture.observations.find((item) => item.sequence === sequence);
      if (!observation) throw new Error("Observation not found");
      observation.captureIdentity = identity;
    }
    writeFileSync(path, JSON.stringify(capture), { mode: 0o600 });
    return capture.record;
  }

  classify(projectId: string, observationId: string, classification: ObservationClassification): CaptureObservation {
    const captureId = observationId.slice(0, 36);
    const path = join(this.directory(projectId, captureId), "derived.json");
    const capture = JSON.parse(readFileSync(path, "utf8")) as DerivedCapture;
    const observation = capture.observations.find((item) => item.id === observationId);
    if (!observation) throw new Error("Observation not found");
    observation.classification = classification;
    writeFileSync(path, JSON.stringify(capture), { mode: 0o600 });
    return observation;
  }
}
