import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { gateRun, startRun } from "../security-team.mjs";

test("creates exactly three scoped pentest prompts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "surfacetrace-team-"));
  const runDir = await startRun(["pentest", "--target", ".", "--authorization", "test", "--out", root], new Date("2026-08-30T12:00:00Z"));
  const manifest = JSON.parse(await readFile(path.join(runDir, "manifest.json")));
  assert.equal(manifest.agents.length, 3);
  assert.equal(manifest.mode, "passive");
});

test("rejects non-loopback active testing", async () => {
  await assert.rejects(() => startRun(["redteam", "--target", "https://example.com", "--authorization", "test", "--mode", "active-local"]), /loopback/);
});

test("gate requires three evidence-backed matching receipts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "surfacetrace-team-"));
  const runDir = await startRun(["redteam", "--authorization", "test", "--out", root], new Date("2026-08-30T12:00:00Z"));
  const manifest = JSON.parse(await readFile(path.join(runDir, "manifest.json")));
  for (const agent of manifest.agents) {
    const receipt = { agent, run_id: manifest.run_id, scope_sha256: manifest.scope_sha256, status: "PASS", findings: [], checks: [{ name: "review", result: "PASS", evidence: "packages/core/test" }], limitations: [] };
    await writeFile(path.join(runDir, "receipts", `${agent}.json`), JSON.stringify(receipt));
  }
  assert.equal((await gateRun(runDir)).status, "PASS");
});

test("gate freezes when the manifest agent roster is reduced", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "surfacetrace-team-"));
  const runDir = await startRun(["pentest", "--authorization", "test", "--out", root], new Date("2026-08-30T12:00:00Z"));
  const manifestPath = path.join(runDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath));
  manifest.agents.pop();
  await writeFile(manifestPath, JSON.stringify(manifest));
  assert.equal((await gateRun(runDir)).status, "FREEZE");
});

test("gate blocks PASS receipts containing failed checks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "surfacetrace-team-"));
  const runDir = await startRun(["redteam", "--authorization", "test", "--out", root], new Date("2026-08-30T12:00:00Z"));
  const manifest = JSON.parse(await readFile(path.join(runDir, "manifest.json")));
  for (const agent of manifest.agents) {
    const receipt = { agent, run_id: manifest.run_id, scope_sha256: manifest.scope_sha256, status: "PASS", findings: [], checks: [{ name: "review", result: agent === manifest.agents[0] ? "FAIL" : "PASS", evidence: "test evidence" }], limitations: [] };
    await writeFile(path.join(runDir, "receipts", `${agent}.json`), JSON.stringify(receipt));
  }
  assert.equal((await gateRun(runDir)).status, "BLOCK");
});
