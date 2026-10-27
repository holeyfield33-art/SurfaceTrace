import { useEffect, useMemo, useState } from "react";

type Identity = "ACCOUNT_A" | "ACCOUNT_B" | "ANONYMOUS" | "UNASSIGNED";
interface Capture {
  id: string; captureIdentity: Identity; sourceFilename: string; description: string;
  importedAt: string; capturedAt: string | null; rawPath: string; rawReference: string; rawSha256: string;
  observationCount: number; endpointCount: number; authFingerprints: string[];
  tokenFingerprints: string[];
  identityConsistency: string; warnings: string[];
}
interface Observation {
  id: string; captureId: string; captureIdentity: Identity; requestAuthState: "PRESENT" | "NONE";
  authFingerprints: string[]; sequence: number; endpointId: string; method: string;
  tokenFingerprints: string[];
  classification?: string;
  url: string; pathTemplate: string; responseStatus: number; responseBodyShape: string | null;
  requestBodyShape: string | null; capturedAt: string; parsedInputs: Array<{ name: string; location: string }>;
  http: { request: { body: string | null; headers: Record<string, string> }; response: { body: string | null; headers: Record<string, string> } };
}
interface Endpoint { id: string; host: string; method: string; pathTemplate: string }
interface Relationship { id: string; identity: Identity; relation: "OWNS" | "USES"; objectType: string; objectFingerprint: string; confidence: string; evidenceObservationId: string }
interface Comparison { id: string; endpointId: string; changedInput: string; conclusion: string; resultSummary: string; evidenceHash: string; createdAt: string }
interface IdentityRecord { id: Identity; alias: string; researcherControlled: boolean | null; verificationStatus: string; associatedCaptureIds: string[]; sessionFingerprints: string[] }
interface IntakeProfile {
  credentialHosts: string[]; authCookiePattern: string; tokenFieldPattern: string; profilePaths: string[];
  profileIdFields: string[]; excludedHosts: string[]; extraRedactNames: string[]; scopeNote: string;
}
interface Index { campaign: { name: string }; profile?: IntakeProfile; captures: Capture[]; archivedCaptures?: Capture[]; observations: Observation[]; endpoints: Endpoint[]; ownershipRelationships: Relationship[]; identities: IdentityRecord[]; comparisons: Comparison[] }
interface ActiveScope { active: boolean; allowedHosts: string[]; allowedMethods: string[]; minRequestIntervalMs?: number }
const listText = (items: string[] | undefined) => (items ?? []).join(", ");
const parseList = (text: string) => text.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
const hostExcluded = (host: string, patterns: string[]) => patterns.some((pattern) => pattern.startsWith("*.")
  ? host === pattern.slice(2) || host.endsWith(pattern.slice(1)) : host === pattern);
const identities: Identity[] = ["ACCOUNT_A", "ACCOUNT_B", "ANONYMOUS", "UNASSIGNED"];
const label = (value: Identity) => value.replace("_", " ");
const publicLooking = (path: string) => /\.(?:js|css|svg|png|jpe?g|woff2?)$|\/static\/|\/logos\/|\/public\//i.test(path);
function fieldPaths(shape: string | null): string[] {
  if (!shape) return [];
  try {
    const value = JSON.parse(shape) as unknown;
    const paths: string[] = [];
    const visit = (item: unknown, prefix: string, depth: number) => {
      if (depth > 6 || !item || typeof item !== "object") return;
      for (const [name, child] of Object.entries(item)) {
        const path = prefix ? `${prefix}.${name}` : name;
        paths.push(path);
        visit(child, path, depth + 1);
      }
    };
    visit(value, "", 0);
    return paths;
  } catch { return []; }
}

export function CaptureWorkspace({ onActivate }: { onActivate?: (captureId: string) => Promise<void> }) {
  const [index, setIndex] = useState<Index | null>(null);
  const [activeScope, setActiveScope] = useState<ActiveScope | null>(null);
  const [identity, setIdentity] = useState<Identity>("UNASSIGNED");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  const [selectedEndpoint, setSelectedEndpoint] = useState("");
  const [selectedObservation, setSelectedObservation] = useState("");
  const [selectedCapture, setSelectedCapture] = useState("");
  const [endpointSearch, setEndpointSearch] = useState("");
  const [objectType, setObjectType] = useState("profile");
  const [objectValue, setObjectValue] = useState("");
  const [relation, setRelation] = useState<"OWNS" | "USES">("OWNS");
  const [confidence, setConfidence] = useState<"CONFIRMED" | "PROBABLE">("PROBABLE");
  const [changedInput, setChangedInput] = useState("identity/session");
  const [baselineValueClass, setBaselineValueClass] = useState("Account A session");
  const [proposedValueClass, setProposedValueClass] = useState("Account B session");
  const [expectedPolicy, setExpectedPolicy] = useState("");
  const [authorization, setAuthorization] = useState("Both accounts are researcher-controlled");
  const [stopCondition, setStopCondition] = useState("Stop if unexpected private data appears");
  const [resultSummary, setResultSummary] = useState("");
  const [conclusion, setConclusion] = useState("INCONCLUSIVE");
  const [profileDraft, setProfileDraft] = useState<Record<keyof IntakeProfile, string> | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);
  function draftFrom(profile: IntakeProfile) {
    return {
      credentialHosts: listText(profile.credentialHosts), authCookiePattern: profile.authCookiePattern,
      tokenFieldPattern: profile.tokenFieldPattern, profilePaths: listText(profile.profilePaths),
      profileIdFields: listText(profile.profileIdFields), excludedHosts: listText(profile.excludedHosts),
      extraRedactNames: listText(profile.extraRedactNames), scopeNote: profile.scopeNote,
    };
  }
  async function saveProfile() {
    if (!profileDraft) return;
    setError(""); setProfileSaved(false);
    const response = await fetch("/api/campaign/profile", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        credentialHosts: parseList(profileDraft.credentialHosts), authCookiePattern: profileDraft.authCookiePattern,
        tokenFieldPattern: profileDraft.tokenFieldPattern, profilePaths: parseList(profileDraft.profilePaths),
        profileIdFields: parseList(profileDraft.profileIdFields), excludedHosts: parseList(profileDraft.excludedHosts),
        extraRedactNames: parseList(profileDraft.extraRedactNames), scopeNote: profileDraft.scopeNote,
      }),
    });
    if (!response.ok) { setError("Intake profile could not be saved"); return; }
    setProfileDraft(draftFrom((await response.json() as { profile: IntakeProfile }).profile));
    setProfileSaved(true);
    await reload();
  }
  async function reload() {
    const response = await fetch("/api/campaign/index");
    if (!response.ok) throw new Error("Campaign index could not be loaded");
    const next = await response.json() as Index;
    setIndex(next);
    if (next.profile) setProfileDraft((current) => current ?? draftFrom(next.profile!));
    setSelectedCapture((current) => next.captures.some((item) => item.id === current)
      ? current : [...next.captures].sort((a, b) => b.importedAt.localeCompare(a.importedAt))[0]?.id ?? "");
  }
  useEffect(() => {
    void reload().catch((reason) => setError(String(reason)));
    void fetch("/api/scope").then((response) => response.json())
      .then((result: { scope: ActiveScope | null }) => setActiveScope(result.scope))
      .catch(() => undefined);
  }, []);
  const selectedRecord = index?.captures.find((item) => item.id === selectedCapture);
  const captureObservations = useMemo(() => (index?.observations ?? []).filter((item) => item.captureId === selectedCapture), [index, selectedCapture]);
  const endpointIds = useMemo(() => new Set(captureObservations.map((item) => item.endpointId)), [captureObservations]);
  const endpoints = useMemo(() => (index?.endpoints ?? []).filter((item) => endpointIds.has(item.id) &&
    `${item.method} ${item.host} ${item.pathTemplate}`.toLowerCase().includes(endpointSearch.toLowerCase())), [index, endpointIds, endpointSearch]);
  const endpoint = endpoints.find((item) => item.id === selectedEndpoint);
  const endpointAllowed = endpoint && activeScope?.active && activeScope.allowedHosts.includes(endpoint.host) && activeScope.allowedMethods.includes(endpoint.method);
  const matches = (index?.observations ?? []).filter((item) => item.endpointId === selectedEndpoint);
  const a = matches.find((item) => item.captureIdentity === "ACCOUNT_A");
  const b = matches.find((item) => item.captureIdentity === "ACCOUNT_B");
  const aFields = new Set(fieldPaths(a?.responseBodyShape ?? null));
  const bFields = new Set(fieldPaths(b?.responseBodyShape ?? null));
  const onlyA = [...aFields].filter((field) => !bFields.has(field));
  const onlyB = [...bFields].filter((field) => !aFields.has(field));
  const captureMatches = captureObservations.filter((item) => item.endpointId === selectedEndpoint);
  const chosen = captureMatches.find((item) => item.id === selectedObservation) ?? captureMatches[0];
  const chosenPosition = chosen ? captureMatches.findIndex((item) => item.id === chosen.id) : -1;
  function viewCapture(captureId: string) {
    setSelectedCapture(captureId); setSelectedEndpoint(""); setSelectedObservation(""); setEndpointSearch("");
  }
  async function archiveCapture(capture: Capture) {
    if (!window.confirm(`Remove ${capture.sourceFilename} from this campaign view? The local HAR can be restored from Archived captures.`)) return;
    const response = await fetch(`/api/campaign/captures/${capture.id}`, { method: "DELETE" });
    if (!response.ok) { const result = await response.json() as { error?: string }; setError(result.error ?? "Capture could not be archived"); return; }
    setSelectedEndpoint(""); setSelectedObservation(""); await reload();
  }
  async function restoreCapture(captureId: string) {
    const response = await fetch(`/api/campaign/captures/${captureId}/restore`, { method: "POST" });
    if (!response.ok) { setError("Capture could not be restored"); return; }
    await reload(); viewCapture(captureId);
  }
  async function deleteArchived(capture: Capture) {
    if (!window.confirm(`Permanently delete the stored raw HAR and derived data for ${capture.sourceFilename}? This cannot be undone.`)) return;
    const response = await fetch(`/api/campaign/captures/${capture.id}/permanent`, { method: "DELETE" });
    if (!response.ok) { setError("Archived capture could not be deleted"); return; }
    await reload();
  }
  async function importCapture() {
    if (!file) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/campaign/captures", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-surfacetrace-har",
          "X-Capture-Identity": identity,
          "X-Capture-Filename": file.name.replace(/[^\x20-\x7E]/g, "_"),
          "X-Capture-Description": description.replace(/[^\x20-\x7E]/g, "_"),
        },
        body: file,
      });
      const result = await response.json() as { error?: string; detail?: string; capture?: Capture };
      if (!response.ok) throw new Error(result.detail ?? result.error ?? `HTTP ${response.status}`);
      setFile(null); setDescription("");
      await reload();
      if (result.capture) viewCapture(result.capture.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  async function reassign(captureId: string, next: Identity, sequence?: number) {
    setError("");
    const response = await fetch(`/api/campaign/captures/${captureId}/identity`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: next, ...(sequence === undefined ? {} : { sequence }) }),
    });
    if (!response.ok) { setError("Assignment could not be changed"); return; }
    await reload();
  }
  async function saveRelationship(observation: Observation) {
    setError("");
    const response = await fetch("/api/campaign/relationships", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: observation.captureIdentity, relation, objectType, objectValue, confidence, evidenceObservationId: observation.id }),
    });
    if (!response.ok) { setError("Ownership needs an Account A/B observation and an object you control."); return; }
    setObjectValue("");
    await reload();
  }
  async function verify(captureId: string) {
    const response = await fetch(`/api/campaign/captures/${captureId}/verify`);
    if (!response.ok) { setError("Raw capture could not be verified"); return; }
    const result = await response.json() as { intact: boolean };
    setVerified((current) => ({ ...current, [captureId]: result.intact }));
  }
  async function verifyIdentity(observation: Observation) {
    const response = await fetch(`/api/campaign/identities/${observation.captureIdentity}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: "Researcher verified this capture context", evidenceObservationId: observation.id }),
    });
    if (!response.ok) { setError("Identity verification needs a matching observation"); return; }
    await reload();
  }
  async function classify(observation: Observation, classification: string) {
    const response = await fetch(`/api/campaign/observations/${encodeURIComponent(observation.id)}/classification`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ classification }),
    });
    if (!response.ok) { setError("Classification could not be saved"); return; }
    await reload();
  }
  async function saveComparison(baseline: Observation, result: Observation) {
    setError("");
    const response = await fetch("/api/campaign/comparisons", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baselineObservationId: baseline.id, resultObservationId: result.id,
        changedInput, baselineValueClass, proposedValueClass, expectedPolicy, authorization,
        stopCondition, resultSummary, conclusion }),
    });
    if (!response.ok) { setError("Comparison could not be saved; use A/B observations of the same endpoint."); return; }
    setResultSummary(""); setConclusion("INCONCLUSIVE");
    await reload();
  }
  return <main className="dashboard reveal capture-workspace">
    <section className="panel">
      <small>A/B CAPTURE WORKFLOW · {index?.campaign.name ?? "CAMPAIGN"}</small>
      <h1>Private captures</h1>
      <p>Assign the account used while browsing. Each request separately records whether account credentials were detected. Raw HAR stays in the ignored local private-captures directory; the UI displays redacted observations.</p>
      <div className="capture-form">
        <label>Captured under <select aria-label="Capture identity" value={identity} onChange={(event) => setIdentity(event.target.value as Identity)}>{identities.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></label>
        <label>Description <input aria-label="Capture description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Profile browsing" /></label>
        <label>Complete HAR <input aria-label="Complete HAR" type="file" accept=".har,application/json" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
        <button className="action" disabled={!file || busy} onClick={() => void importCapture()}>{busy ? "IMPORTING…" : "IMPORT PRIVATE HAR"}</button>
      </div>
      {error && <p className="error">{error}</p>}
      {profileDraft && <details>
        <summary>Intake profile for this campaign</summary>
        <p>Target-specific detection rules. Defaults are generic; tune them for each program. Applies to captures imported after saving.</p>
        <label>Credential hosts (blank = all hosts; <code>*.example.com</code> allowed) <input aria-label="Credential hosts" value={profileDraft.credentialHosts} onChange={(event) => setProfileDraft({ ...profileDraft, credentialHosts: event.target.value })} /></label>
        <label>Auth cookie name pattern (regex) <input aria-label="Auth cookie pattern" value={profileDraft.authCookiePattern} onChange={(event) => setProfileDraft({ ...profileDraft, authCookiePattern: event.target.value })} /></label>
        <label>Response token field pattern (regex) <input aria-label="Token field pattern" value={profileDraft.tokenFieldPattern} onChange={(event) => setProfileDraft({ ...profileDraft, tokenFieldPattern: event.target.value })} /></label>
        <label>Profile / whoami paths <input aria-label="Profile paths" value={profileDraft.profilePaths} onChange={(event) => setProfileDraft({ ...profileDraft, profilePaths: event.target.value })} /></label>
        <label>Person ID fields <input aria-label="Person ID fields" value={profileDraft.profileIdFields} onChange={(event) => setProfileDraft({ ...profileDraft, profileIdFields: event.target.value })} /></label>
        <label>Out-of-scope hosts <input aria-label="Out-of-scope hosts" value={profileDraft.excludedHosts} onChange={(event) => setProfileDraft({ ...profileDraft, excludedHosts: event.target.value })} /></label>
        <label>Extra credential names to scrub from notes <input aria-label="Extra credential names" value={profileDraft.extraRedactNames} onChange={(event) => setProfileDraft({ ...profileDraft, extraRedactNames: event.target.value })} /></label>
        <label>Scope source note <input aria-label="Scope source note" value={profileDraft.scopeNote} onChange={(event) => setProfileDraft({ ...profileDraft, scopeNote: event.target.value })} placeholder="e.g. Program scope CSV, 2026-10-01" /></label>
        <button onClick={() => void saveProfile()}>SAVE INTAKE PROFILE</button>{profileSaved && <small> Saved.</small>}
      </details>}
    </section>
    <section className="panel">
      <small>CAPTURE INDEX</small>
      <h2>{index?.campaign.name ?? "Campaign"} · {index?.captures.length ?? 0} captures</h2>
      <p>Select a HAR to view only its endpoints and requests. Account A/B comparisons can still show matching requests from the other capture.</p>
      {(index?.captures ?? []).map((capture) => <article className="capture-card" key={capture.id}>
        <strong>{capture.id === selectedCapture ? "VIEWING: " : ""}{capture.sourceFilename}</strong><span>{label(capture.captureIdentity)} · {capture.observationCount} observations · {capture.endpointCount} endpoints</span>
        <div className="capture-actions"><button className={capture.id === selectedCapture ? "action" : ""} onClick={() => viewCapture(capture.id)}>{capture.id === selectedCapture ? "VIEWING THIS HAR" : "VIEW HAR"}</button>{onActivate && <button onClick={() => void onActivate(capture.id)}>OPEN IN INVESTIGATION</button>}<button onClick={() => void archiveCapture(capture)}>REMOVE FROM VIEW</button></div>
        <label>Captured under <select aria-label={`Identity for ${capture.sourceFilename}`} value={capture.captureIdentity} onChange={(event) => void reassign(capture.id, event.target.value as Identity)}>{identities.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></label>
        <small>{capture.identityConsistency} · {capture.authFingerprints.length} request credential fingerprints · {capture.tokenFingerprints?.length ?? 0} response token fingerprints · captured {capture.capturedAt ?? "unknown"}</small>
        <small>SHA-256 {capture.rawSha256} · raw: {capture.rawReference ?? capture.rawPath}</small>
        <button onClick={() => void verify(capture.id)}>VERIFY RAW HASH</button>
        {verified[capture.id] !== undefined && <small>{verified[capture.id] ? "Raw bytes match import hash" : "Raw capture hash mismatch"}</small>}
        {capture.warnings.map((warning) => <p className="error" key={warning}>{warning}</p>)}
      </article>)}
      {!index?.captures.length && <p>Import separate HARs for Account A and Account B after using each researcher-owned account normally.</p>}
      {!!index?.archivedCaptures?.length && <details><summary>Archived captures ({index.archivedCaptures.length})</summary>{index.archivedCaptures.map((capture) => <p key={capture.id}>{capture.sourceFilename} · {label(capture.captureIdentity)} <button onClick={() => void restoreCapture(capture.id)}>RESTORE</button> <button onClick={() => void deleteArchived(capture)}>DELETE PERMANENTLY</button></p>)}</details>}
      <h3>Local identities</h3>
      {(index?.identities ?? []).map((item) => <p key={item.id}>{item.alias}: {item.verificationStatus.toLowerCase()} · {item.associatedCaptureIds.length} captures · {item.sessionFingerprints.length} credential fingerprints</p>)}
    </section>
    <section className="panel">
      <small>ENDPOINT REVIEW</small>
      <h2>{selectedRecord ? `Viewing ${selectedRecord.sourceFilename}` : "Choose a HAR above"}</h2>
      {selectedRecord && <p>{label(selectedRecord.captureIdentity)} · captured {selectedRecord.capturedAt ?? "unknown"} · {captureObservations.length} requests</p>}
      <p className="not-applicable">Captured traffic can include third-party and excluded hosts. Viewing a HAR does not authorize active testing.{index?.profile?.excludedHosts.length ? ` Out-of-scope hosts for this campaign: ${index.profile.excludedHosts.join(", ")}${index.profile.scopeNote ? ` (${index.profile.scopeNote})` : ""}.` : ""}</p>
      <label>Find endpoint <input aria-label="Find endpoint" value={endpointSearch} onChange={(event) => { setEndpointSearch(event.target.value); setSelectedEndpoint(""); setSelectedObservation(""); }} placeholder="host or path fragment…" /></label>
      <label>Captured endpoint <select aria-label="Captured endpoint" value={selectedEndpoint} onChange={(event) => { setSelectedEndpoint(event.target.value); setSelectedObservation(""); }}><option value="">Choose an endpoint</option>{endpoints.map((item) => <option value={item.id} key={item.id}>{item.method} {item.host}{item.pathTemplate}</option>)}</select></label>
      {endpoint && <>
        <p>{endpoint.method} · {endpoint.host} · {endpoint.pathTemplate}</p>
        <p className={endpointAllowed ? "" : "error"}>{hostExcluded(endpoint.host, index?.profile?.excludedHosts ?? [])
          ? `EXPLICITLY OUT OF SCOPE for this campaign${index?.profile?.scopeNote ? ` (${index.profile.scopeNote})` : ""}. Do not actively test this host.`
          : endpointAllowed ? "Included in the current SurfaceTrace active test scope. Follow the program rules before sending."
          : "Not allowed by the current SurfaceTrace test scope. Do not send active requests to this endpoint."}</p>
        {publicLooking(endpoint.pathTemplate) ? <p className="not-applicable">Likely public or static request. Account A/B comparison has low authorization priority.</p> : <div className="capture-comparison">
          <div><strong>ACCOUNT A</strong><p>{a ? `${a.responseStatus} · auth ${a.requestAuthState.toLowerCase()} · capture ${a.captureId.slice(0, 8)}` : "No captured observation"}</p></div>
          <div><strong>ACCOUNT B</strong><p>{b ? `${b.responseStatus} · auth ${b.requestAuthState.toLowerCase()} · capture ${b.captureId.slice(0, 8)}` : "No captured observation"}</p></div>
          {a && b && <p>Both controlled capture contexts are available. Compare response meaning and ownership before proposing a one-variable Burp test; matching status codes are inconclusive.</p>}
          {a && b && <p>Schema fields only in A: {onlyA.slice(0, 12).join(", ") || "none"}. Only in B: {onlyB.slice(0, 12).join(", ") || "none"}. Volatile values and token rotation are not treated as findings.</p>}
        </div>}
        {a && b && !publicLooking(endpoint.pathTemplate) && <div className="capture-worksheet">
          <h3>Controlled comparison notebook</h3>
          <p>Documentation only. Use Burp Repeater for a deliberate request, then record the redacted result here. Keep all other inputs constant.</p>
          <label>One changed input <input aria-label="A/B changed input" value={changedInput} onChange={(event) => setChangedInput(event.target.value)} /></label>
          <label>Baseline value class <input aria-label="A/B baseline value class" value={baselineValueClass} onChange={(event) => setBaselineValueClass(event.target.value)} /></label>
          <label>Proposed value class <input aria-label="A/B proposed value class" value={proposedValueClass} onChange={(event) => setProposedValueClass(event.target.value)} /></label>
          <label>Expected security rule <input aria-label="A/B expected policy" value={expectedPolicy} onChange={(event) => setExpectedPolicy(event.target.value)} /></label>
          <label>Why authorized? <input aria-label="A/B authorization" value={authorization} onChange={(event) => setAuthorization(event.target.value)} /></label>
          <label>Stop condition <input aria-label="A/B stop condition" value={stopCondition} onChange={(event) => setStopCondition(event.target.value)} /></label>
          <label>Redacted Burp result or observation <textarea aria-label="A/B result summary" value={resultSummary} onChange={(event) => setResultSummary(event.target.value)} /></label>
          <label>Conclusion <select aria-label="A/B conclusion" value={conclusion} onChange={(event) => setConclusion(event.target.value)}><option value="INCONCLUSIVE">Inconclusive</option><option value="CONFIRMED_BOUNDARY">Confirmed boundary</option><option value="POTENTIAL_FINDING">Potential finding for manual review</option></select></label>
          <button className="action" disabled={!changedInput.trim() || !expectedPolicy.trim()} onClick={() => void saveComparison(a, b)}>SAVE COMPARISON EVIDENCE</button>
        </div>}
        <label>Request in {selectedRecord?.sourceFilename} <select aria-label="Capture observation" value={chosen?.id ?? ""} onChange={(event) => setSelectedObservation(event.target.value)}>{captureMatches.map((item) => <option key={item.id} value={item.id}>#{item.sequence} · {item.responseStatus} · {item.capturedAt}</option>)}</select></label>
        {chosen && <div className="capture-actions"><button disabled={chosenPosition <= 0} onClick={() => setSelectedObservation(captureMatches[chosenPosition - 1]!.id)}>PREVIOUS REQUEST</button><span>{chosenPosition + 1} of {captureMatches.length} for this endpoint</span><button disabled={chosenPosition >= captureMatches.length - 1} onClick={() => setSelectedObservation(captureMatches[chosenPosition + 1]!.id)}>NEXT REQUEST</button></div>}
        {chosen && <div className="capture-observation">
          <h3>Current request</h3>
          <p><strong>{chosen.method}</strong> {chosen.url} · {chosen.responseStatus}</p>
          <p>Captured under: <strong>{label(chosen.captureIdentity)}</strong> · Request authentication: <strong>{chosen.requestAuthState === "PRESENT" ? "credentials detected" : "none detected"}</strong></p>
          <p>Credential fingerprints: {chosen.authFingerprints.length ? chosen.authFingerprints.join(", ") : "none"}</p>
          <p>Response token fingerprints: {chosen.tokenFingerprints?.length ? chosen.tokenFingerprints.join(", ") : "none"}</p>
          <p>What am I looking at? {publicLooking(chosen.pathTemplate) ? "Likely public or static data; low authorization priority." : /profile|wallet|token|session|rewards/i.test(chosen.pathTemplate) ? "Possible account or session data; review the identity boundary." : "Captured request; inspect the response before classifying."} This is a clue, not a security verdict.</p>
          <p>Request body: {chosen.requestBodyShape ?? "none detected"} · Response shape: {chosen.responseBodyShape ?? "not available"}</p>
          <p>Observed inputs: {chosen.parsedInputs.map((item) => `${item.location}:${item.name}`).join(", ") || "none"}</p>
          <label>Classify this observation <select aria-label="Capture observation classification" value={chosen.classification ?? "UNKNOWN"} onChange={(event) => void classify(chosen, event.target.value)}>{["UNKNOWN", "PUBLIC_INFORMATIONAL", "ACCOUNT_SPECIFIC", "AUTHENTICATED_PRIVATE_DATA", "STATE_CHANGING", "IDENTITY_SESSION", "TOKEN_CREDENTIAL", "OBJECT_OWNERSHIP_CANDIDATE"].map((item) => <option value={item} key={item}>{item.replaceAll("_", " ")}</option>)}</select></label>
          <label>Correct this observation's capture identity <select aria-label="Observation identity" value={chosen.captureIdentity} onChange={(event) => void reassign(chosen.captureId, event.target.value as Identity, chosen.sequence)}>{identities.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></label>
          {["ACCOUNT_A", "ACCOUNT_B"].includes(chosen.captureIdentity) && chosen.requestAuthState === "PRESENT" && /\/(?:profile|validate\/user)(?:\/|$)/i.test(chosen.pathTemplate) && <button onClick={() => void verifyIdentity(chosen)}>CONFIRM THIS CAPTURE IDENTITY</button>}
          {["ACCOUNT_A", "ACCOUNT_B"].includes(chosen.captureIdentity) && <div className="capture-ownership">
            <h3>Record an owned object</h3>
            <p>Use an identifier from an object you control. SurfaceTrace stores only a local fingerprint and links this observation as evidence.</p>
            <label>Object type <input aria-label="Owned object type" value={objectType} onChange={(event) => setObjectType(event.target.value)} /></label>
            <label>Object identifier <input aria-label="Owned object identifier" value={objectValue} onChange={(event) => setObjectValue(event.target.value)} /></label>
            <label>Relationship <select aria-label="Ownership relationship" value={relation} onChange={(event) => setRelation(event.target.value as "OWNS" | "USES")}><option value="OWNS">Owns</option><option value="USES">Uses</option></select></label>
            <label>Confidence <select aria-label="Ownership confidence" value={confidence} onChange={(event) => setConfidence(event.target.value as "CONFIRMED" | "PROBABLE")}><option value="PROBABLE">Probable</option><option value="CONFIRMED">Confirmed by this observation</option></select></label>
            <button className="action" disabled={!objectValue.trim()} onClick={() => void saveRelationship(chosen)}>SAVE RELATIONSHIP</button>
          </div>}
        </div>}
      </>}
    </section>
    <section className="panel"><small>EVIDENCE-BACKED RELATIONSHIPS</small><h2>Owned objects</h2>
      {(index?.ownershipRelationships ?? []).map((item) => <p key={item.id}>{label(item.identity)} {item.relation.toLowerCase()} {item.objectType} · fingerprint {item.objectFingerprint} · {item.confidence.toLowerCase()} · observation {item.evidenceObservationId.slice(0, 8)}</p>)}
      {!index?.ownershipRelationships.length && <p>No ownership relationship recorded yet.</p>}
    </section>
    <section className="panel"><small>COMPARISON HISTORY</small><h2>Saved A/B evidence</h2>
      {(index?.comparisons ?? []).map((item) => <p key={item.id}>{item.createdAt} · {item.changedInput} · {item.conclusion.replaceAll("_", " ").toLowerCase()} · {item.resultSummary || "no result note"} · hash {item.evidenceHash.slice(0, 16)}</p>)}
      {!index?.comparisons?.length && <p>No A/B comparison recorded yet.</p>}
    </section>
  </main>;
}
