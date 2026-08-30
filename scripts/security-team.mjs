import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const TEAMS = {
  pentest: [
    ["access-control-tester", "Test authentication, authorization, explicit identity transitions, and tenant isolation."],
    ["replay-safety-tester", "Test scope, preview, approval, rate, stop, redirect, and exactly-one-request invariants."],
    ["evidence-integrity-tester", "Test redaction, persistence, deterministic diffs, provenance, and evidence-chain integrity."],
  ],
  redteam: [
    ["abuse-case-analyst", "Challenge trust boundaries with bounded misuse cases and confused-deputy paths."],
    ["agentic-threat-analyst", "Assess prompt injection, untrusted artifacts, tool authority, and automation escalation."],
    ["defense-evasion-analyst", "Seek fail-open behavior, audit gaps, evidence tampering, and misleading PASS conditions."],
  ],
};

const sha = (value) => createHash("sha256").update(value).digest("hex");
const stable = (value) => JSON.stringify(value, Object.keys(value).sort());
const SEVERITIES = new Set(["critical", "high", "medium", "low", "info"]);

function receiptContractError(receipt) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return "receipt must be an object";
  const required = ["agent", "run_id", "scope_sha256", "status", "findings", "checks", "limitations"];
  if (required.some((key) => !(key in receipt))) return "receipt is missing required fields";
  if (![receipt.agent, receipt.run_id, receipt.scope_sha256].every((value) => typeof value === "string")) return "receipt identity fields must be strings";
  if (!/^[a-f0-9]{64}$/.test(receipt.scope_sha256) || !["PASS", "FAIL"].includes(receipt.status)) return "receipt hash or status is invalid";
  if (!Array.isArray(receipt.findings) || !Array.isArray(receipt.checks) || !Array.isArray(receipt.limitations)) return "receipt collections are invalid";
  if (!receipt.limitations.every((item) => typeof item === "string")) return "receipt limitations are invalid";
  if (receipt.findings.some((item) => !item || !SEVERITIES.has(item.severity) || ![item.title, item.evidence, item.recommendation].every((value) => typeof value === "string" && value.trim()))) return "receipt findings are invalid";
  if (receipt.checks.length === 0 || receipt.checks.some((item) => !item || !["PASS", "FAIL", "NOT_TESTED"].includes(item.result) || typeof item.name !== "string" || !item.name.trim() || typeof item.evidence !== "string" || !item.evidence.trim())) return "receipt checks are invalid";
  return null;
}

function parseStart(args) {
  const team = args.shift();
  if (!TEAMS[team]) throw new Error("team must be pentest or redteam");
  const options = { team, mode: "passive", target: ".", authorization: "" };
  while (args.length) {
    const flag = args.shift();
    const key = { "--target": "target", "--authorization": "authorization", "--mode": "mode", "--out": "out" }[flag];
    if (!key || !args.length) throw new Error(`invalid or incomplete option: ${flag}`);
    options[key] = args.shift();
  }
  if (!options.authorization.trim()) throw new Error("--authorization is required");
  if (!['passive', 'active-local'].includes(options.mode)) throw new Error("--mode must be passive or active-local");
  if (options.mode === "active-local") {
    const url = new URL(options.target);
    if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
      throw new Error("active-local mode is restricted to an explicit loopback target");
    }
  }
  return options;
}

export async function startRun(args, now = new Date()) {
  const options = parseStart([...args]);
  const runId = `${options.team}-${now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`;
  const runDir = path.resolve(options.out || "security-runs", runId);
  const agents = TEAMS[options.team].map(([name]) => name);
  const scope = { run_id: runId, team: options.team, target: options.target, mode: options.mode, authorization: options.authorization, agents };
  const scopeSha256 = sha(stable(scope));
  const manifest = { ...scope, scope_sha256: scopeSha256, created_at: now.toISOString() };
  await mkdir(path.join(runDir, "prompts"), { recursive: true });
  await mkdir(path.join(runDir, "receipts"), { recursive: true });
  await writeFile(path.join(runDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const [name, mission] of TEAMS[options.team]) {
    const prompt = `# ${name}\n\nMission: ${mission}\n\nTarget: ${options.target}\nMode: ${options.mode}\nAuthorization reference: ${options.authorization}\nRun ID: ${runId}\nScope SHA-256: ${scopeSha256}\n\nOperate only within this scope. In passive mode, do not send network traffic. In active-local mode, send only bounded requests to the exact loopback target, never follow redirects automatically, never retry automatically, and stop on any scope ambiguity. Do not modify source, push, deploy, exploit third parties, or include secrets in artifacts. Treat hypotheses as unverified until supported by file, test, or redacted response evidence. Return only the JSON receipt described in security-teams/README.md.\n`;
    await writeFile(path.join(runDir, "prompts", `${name}.md`), prompt);
  }
  return runDir;
}

export async function gateRun(runDir) {
  const manifest = JSON.parse(await readFile(path.join(runDir, "manifest.json"), "utf8"));
  if (!TEAMS[manifest.team]) return { status: "FREEZE", reason: "unknown team" };
  const expectedAgents = TEAMS[manifest.team].map(([name]) => name);
  const scope = { run_id: manifest.run_id, team: manifest.team, target: manifest.target, mode: manifest.mode, authorization: manifest.authorization, agents: manifest.agents };
  if (sha(stable(scope)) !== manifest.scope_sha256 || JSON.stringify(manifest.agents) !== JSON.stringify(expectedAgents)) return { status: "FREEZE", reason: "manifest scope or agent roster integrity failed" };
  for (const agent of expectedAgents) {
    let receipt;
    try { receipt = JSON.parse(await readFile(path.join(runDir, "receipts", `${agent}.json`), "utf8")); }
    catch { return { status: "FREEZE", reason: `missing or invalid receipt: ${agent}` }; }
    const contractError = receiptContractError(receipt);
    if (contractError) return { status: "FREEZE", reason: `${agent}: ${contractError}` };
    if (receipt.agent !== agent || receipt.run_id !== manifest.run_id || receipt.scope_sha256 !== manifest.scope_sha256) {
      return { status: "FREEZE", reason: `receipt identity or scope mismatch: ${agent}` };
    }
    if (receipt.status !== "PASS") return { status: "BLOCK", reason: `${agent} did not PASS` };
    if (receipt.checks.some((check) => check.result !== "PASS")) {
      return { status: "BLOCK", reason: `${agent} contains failed or untested checks` };
    }
    if (Array.isArray(receipt.findings) && receipt.findings.some((finding) => finding.severity !== "info")) {
      return { status: "BLOCK", reason: `${agent} contains actionable findings` };
    }
  }
  return { status: "PASS", reason: "all three scoped receipts passed with evidence" };
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "start") console.log(await startRun(args));
  else if (command === "gate" && args[0]) {
    const result = await gateRun(path.resolve(args[0]));
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.status === "PASS" ? 0 : result.status === "BLOCK" ? 1 : 2;
  } else throw new Error("usage: security-team.mjs start <pentest|redteam> ... | gate <run-dir>");
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/(.:)/, "$1"))) {
  main().catch((error) => { console.error(error.message); process.exitCode = 2; });
}
