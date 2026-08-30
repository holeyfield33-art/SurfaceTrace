# SurfaceTrace Security Teams

These teams turn a bounded SurfaceTrace review into three independent specialist assignments. The runner creates prompts and a signed scope manifest; it does not call a model, send network traffic, or authorize testing.

## Teams

The `pentest` team covers application boundaries:

- `access-control-tester`: authentication, authorization, identity transitions, and tenant isolation.
- `replay-safety-tester`: scope, preview, approval, rate, stop, redirect, and one-request invariants.
- `evidence-integrity-tester`: redaction, persistence, deterministic diffs, and hash-linked evidence.

The `redteam` team challenges assumptions:

- `abuse-case-analyst`: misuse paths, confused-deputy behavior, and dangerous compositions.
- `agentic-threat-analyst`: prompt injection, untrusted artifacts, tool authority, and automation escalation.
- `defense-evasion-analyst`: fail-open behavior, audit gaps, tampering, and misleading PASS conditions.

## Start A Run

Passive source review is the default:

```powershell
npm run team:pentest -- --target . --authorization "engagement-id"
npm run team:redteam -- --target . --authorization "engagement-id"
```

Active testing is accepted only for an explicit loopback URL:

```powershell
npm run team:pentest -- --target http://127.0.0.1:4040 --authorization "local-lab" --mode active-local
```

The command prints a `security-runs/<run-id>` path. Give each generated prompt to one independent agent and save its JSON response as `receipts/<agent-name>.json`. Then run:

```powershell
npm run team:gate -- security-runs/<run-id>
```

`PASS` means all three receipts are valid and evidence-backed. `BLOCK` means a specialist failed or omitted evidence. `FREEZE` means scope or receipt integrity is invalid. Human review remains the final authority.

## Receipt Contract

```json
{
  "agent": "access-control-tester",
  "run_id": "pentest-...",
  "scope_sha256": "copied from manifest.json",
  "status": "PASS",
  "findings": [],
  "checks": [{"name": "identity isolation", "result": "PASS", "evidence": "packages/server/test/..."}],
  "limitations": []
}
```

Never place credentials, raw cookies, authorization headers, or unredacted traffic in receipts.
