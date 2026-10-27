import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CampaignCaptureVault } from "../src/campaignCaptures.js";
import { buildApp } from "../src/app.js";

const projectId = "00000000-0000-4000-8000-000000000001";
function capture(email: string, secret: string): Buffer {
  const entry = (url: string, cookie: string, body: unknown) => ({
    startedDateTime: "2026-09-29T12:00:00.000Z", time: 1,
    request: {
      method: "GET", url, httpVersion: "HTTP/2", queryString: [],
      headers: cookie ? [{ name: "Cookie", value: `nbaidentity=${cookie}` }] : [],
      cookies: cookie ? [{ name: "nbaidentity", value: cookie }] : [],
    },
    response: {
      status: 200, statusText: "OK", httpVersion: "HTTP/2", headers: [],
      content: { mimeType: "application/json", size: 100, text: JSON.stringify(body) },
    },
  });
  return Buffer.from(JSON.stringify({ log: { version: "1.2", creator: { name: "test", version: "1" }, entries: [
    entry("https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json", "", { scoreboard: [] }),
    entry("https://identity.nba.com/api/v1/profile", secret, { data: { result: { email, jwt: secret } } }),
  ] } }));
}

describe("private A/B capture workflow", () => {
  test("keeps raw bytes intact and secrets out of derived observations", () => {
    const root = mkdtempSync(join(tmpdir(), "surfacetrace-capture-"));
    try {
      const vault = new CampaignCaptureVault(root);
      const rawA = capture("a@example.test", "secret-session-a");
      const rawB = capture("b@example.test", "secret-session-b");
      const a = vault.import(projectId, rawA, "ACCOUNT_A", "a.har");
      const b = vault.import(projectId, rawB, "ACCOUNT_B", "b.har");
      expect(readFileSync(a.rawPath)).toEqual(rawA);
      expect(readFileSync(b.rawPath)).toEqual(rawB);
      expect(vault.verifyRaw(projectId, a.id).intact).toBe(true);
      expect(a.rawSha256).not.toBe(b.rawSha256);
      const loaded = vault.list(projectId);
      expect(loaded).toHaveLength(2);
      const aCapture = loaded.find((item) => item.record.id === a.id)!;
      const bCapture = loaded.find((item) => item.record.id === b.id)!;
      expect(aCapture.observations[0]).toMatchObject({ captureIdentity: "ACCOUNT_A", requestAuthState: "NONE" });
      expect(aCapture.observations[1]).toMatchObject({ captureIdentity: "ACCOUNT_A", requestAuthState: "PRESENT" });
      expect(JSON.stringify(aCapture)).not.toContain("secret-session-a");
      expect(JSON.stringify(aCapture)).not.toContain("a@example.test");
      expect(a.authFingerprints).not.toEqual(b.authFingerprints);
      expect(aCapture.observations[1]!.authFingerprints).toHaveLength(1);
      const verified = vault.updateIdentity(projectId, "ACCOUNT_A", "Owned test account", aCapture.observations[1]!.id);
      expect(verified.verificationStatus).toBe("VERIFIED");
      expect(verified.associatedCaptureIds).toContain(a.id);
      expect(() => vault.updateIdentity(projectId, "ACCOUNT_A", "Invalid", aCapture.observations[0]!.id)).toThrow("matching capture evidence");
      const relationship = vault.addRelationship(projectId, {
        identity: "ACCOUNT_A", relation: "OWNS", objectType: "profile", objectValue: "owned-profile-id",
        confidence: "CONFIRMED", evidenceObservationId: aCapture.observations[1]!.id,
      });
      expect(relationship.objectFingerprint).not.toContain("owned-profile-id");
      expect(JSON.stringify(vault.relationships(projectId))).not.toContain("owned-profile-id");
      expect(() => vault.addRelationship(projectId, {
        identity: "ACCOUNT_B", relation: "OWNS", objectType: "profile", objectValue: "wrong",
        confidence: "CONFIRMED", evidenceObservationId: aCapture.observations[1]!.id,
      })).toThrow("matching captured evidence");
      const comparison = vault.addComparison(projectId, {
        baselineObservationId: aCapture.observations[1]!.id,
        resultObservationId: bCapture.observations[1]!.id,
        changedInput: "identity/session", baselineValueClass: "A session", proposedValueClass: "B session",
        expectedPolicy: "Each account sees its own profile", authorization: "Both accounts owned",
        stopCondition: "Stop on unexpected private data",
        resultSummary: "Bearer secret-session-a and a@example.test were visible in raw evidence",
        conclusion: "INCONCLUSIVE",
      });
      expect(comparison.evidenceHash).toHaveLength(64);
      expect(JSON.stringify(vault.comparisons(projectId))).not.toContain("secret-session-a");
      expect(JSON.stringify(vault.comparisons(projectId))).not.toContain("a@example.test");
      vault.reassign(projectId, a.id, "UNASSIGNED", 1);
      expect(vault.list(projectId).find((item) => item.record.id === a.id)!.observations[1]!.captureIdentity).toBe("UNASSIGNED");
      expect(vault.identities(projectId).find((item) => item.id === "ACCOUNT_A")!.verificationStatus).toBe("UNVERIFIED");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("flags mixed account markers and treats token rotation as the same local identity", () => {
    const root = mkdtempSync(join(tmpdir(), "surfacetrace-mixed-"));
    try {
      const vault = new CampaignCaptureVault(root);
      const a = JSON.parse(capture("a@example.test", "session-1").toString("utf8"));
      const samePerson = JSON.parse(capture("a@example.test", "session-2").toString("utf8"));
      const otherPerson = JSON.parse(capture("b@example.test", "session-3").toString("utf8"));
      a.log.entries.push(samePerson.log.entries[1]);
      const rotation = vault.import(projectId, Buffer.from(JSON.stringify(a)), "ACCOUNT_A", "rotation.har");
      expect(rotation.identityConsistency).toBe("SESSION_ROTATION");
      expect(vault.list(projectId)[0]!.observations.every((item) => item.captureIdentity === "ACCOUNT_A")).toBe(true);
      a.log.entries.push(otherPerson.log.entries[1]);
      const mixed = vault.import(projectId, Buffer.from(JSON.stringify(a)), "ACCOUNT_A", "mixed.har");
      expect(mixed.identityConsistency).toBe("POSSIBLE_MIXED_IDENTITY");
      expect(mixed.warnings).toHaveLength(1);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("ingests a non-NBA target with default and customized intake profiles", () => {
    const root = mkdtempSync(join(tmpdir(), "surfacetrace-profile-"));
    try {
      const vault = new CampaignCaptureVault(root);
      const har = (cookie: string, path: string, body: unknown) => Buffer.from(JSON.stringify({ log: { version: "1.2", creator: { name: "t", version: "1" }, entries: [{
        startedDateTime: "2026-09-29T12:00:00.000Z", time: 1,
        request: { method: "GET", url: `https://api.acme.test${path}`, httpVersion: "HTTP/2", queryString: [],
          headers: [{ name: "Cookie", value: `${cookie}=value-12345678` }], cookies: [{ name: cookie, value: "value-12345678" }] },
        response: { status: 200, statusText: "OK", httpVersion: "HTTP/2", headers: [], content: { mimeType: "application/json", size: 10, text: JSON.stringify(body) } },
      }] } }));
      const generic = vault.import(projectId, har("sessionid", "/api/me", { id: "u-1" }), "ACCOUNT_A", "g.har");
      expect(generic.authFingerprints).toHaveLength(1);
      expect(generic.identityConsistency).toBe("CONFIRMED_SINGLE_IDENTITY");
      const custom = vault.import(projectId, har("acme_key", "/v2/whoami", { data: { profile: { handle: "x" } } }), "ACCOUNT_A", "c.har");
      expect(custom.authFingerprints).toHaveLength(0);
      vault.setProfile(projectId, { authCookiePattern: "^acme_key$", profilePaths: ["/v2/whoami"], profileIdFields: ["handle"], credentialHosts: ["*.acme.test"], excludedHosts: ["PAY.acme.test"] });
      const tuned = vault.import(projectId, har("acme_key", "/v2/whoami", { data: { profile: { handle: "x" } } }), "ACCOUNT_A", "t.har");
      expect(tuned.authFingerprints).toHaveLength(1);
      expect(tuned.identityConsistency).toBe("CONFIRMED_SINGLE_IDENTITY");
      expect(vault.profile(projectId).excludedHosts).toEqual(["pay.acme.test"]);
      expect(vault.setProfile(projectId, { authCookiePattern: "(" }).authCookiePattern).toBe(vault.profile("00000000-0000-4000-8000-0000000000aa").authCookiePattern);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("archives and restores a HAR without changing its raw bytes", () => {
    const root = mkdtempSync(join(tmpdir(), "surfacetrace-archive-"));
    try {
      const vault = new CampaignCaptureVault(root);
      const raw = capture("a@example.test", "secret-session-a");
      const item = vault.import(projectId, raw, "ACCOUNT_A", "a.har");
      vault.archive(projectId, item.id);
      expect(vault.list(projectId)).toHaveLength(0);
      expect(vault.archived(projectId).map((record) => record.id)).toEqual([item.id]);
      vault.restore(projectId, item.id);
      expect(vault.archived(projectId)).toHaveLength(0);
      expect(vault.verifyRaw(projectId, item.id).intact).toBe(true);
      expect(readFileSync(item.rawPath)).toEqual(raw);
      vault.archive(projectId, item.id);
      vault.deleteArchived(projectId, item.id);
      expect(vault.archived(projectId)).toHaveLength(0);
      expect(() => vault.restore(projectId, item.id)).toThrow("Archived capture not found");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("accepts all four capture assignments and compares A/B without sending traffic", async () => {
    const root = mkdtempSync(join(tmpdir(), "surfacetrace-api-capture-"));
    const app = buildApp({ logger: false, dbPath: ":memory:", captureRoot: root });
    try {
      for (const identity of ["ACCOUNT_A", "ACCOUNT_B", "ANONYMOUS", "UNASSIGNED"]) {
        const response = await app.inject({
          method: "POST", url: "/campaign/captures",
          headers: { "content-type": "application/x-surfacetrace-har", "x-capture-identity": identity, "x-capture-filename": `${identity}.har` },
          payload: capture(`${identity}@example.test`, `secret-${identity}`),
        });
        expect(response.statusCode).toBe(201);
      }
      const index = await app.inject({ method: "GET", url: "/campaign/index" });
      expect(index.statusCode).toBe(200);
      const body = index.json() as { captures: Array<{ captureIdentity: string }>; observations: Array<{ captureIdentity: string; endpointId: string }> };
      expect(body.captures).toHaveLength(4);
      expect(new Set(body.captures.map((item) => item.captureIdentity))).toEqual(new Set(["ACCOUNT_A", "ACCOUNT_B", "ANONYMOUS", "UNASSIGNED"]));
      const profiles = body.observations.filter((item) => item.endpointId === body.observations[1]!.endpointId);
      expect(new Set(profiles.map((item) => item.captureIdentity))).toEqual(new Set(["ACCOUNT_A", "ACCOUNT_B", "ANONYMOUS", "UNASSIGNED"]));
      expect(index.body).not.toContain("secret-ACCOUNT_A");
    } finally { await app.close(); rmSync(root, { recursive: true, force: true }); }
  });

  test("opens a private capture in Investigation and clears legacy imports without deleting captures", async () => {
    const root = mkdtempSync(join(tmpdir(), "surfacetrace-activate-"));
    const app = buildApp({ logger: false, dbPath: ":memory:", captureRoot: root });
    try {
      const imported = await app.inject({
        method: "POST", url: "/campaign/captures",
        headers: { "content-type": "application/x-surfacetrace-har", "x-capture-identity": "ACCOUNT_A", "x-capture-filename": "a.har" },
        payload: capture("a@example.test", "secret-session-a"),
      });
      const captureId = (imported.json() as { capture: { id: string } }).capture.id;
      const activated = await app.inject({ method: "POST", url: `/campaign/captures/${captureId}/activate` });
      expect(activated.statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/investigation/source" })).json().activeImport.sourceLabel).toContain("a.har");
      expect((await app.inject({ method: "GET", url: "/inventory" })).statusCode).toBe(200);
      const cleared = await app.inject({ method: "DELETE", url: "/investigation/imports" });
      expect(cleared.statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/inventory" })).statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url: "/investigation/source" })).json().activeImport).toBeNull();
      expect((await app.inject({ method: "GET", url: "/campaign/index" })).json().captures).toHaveLength(1);
    } finally { await app.close(); rmSync(root, { recursive: true, force: true }); }
  });
});
