# SurfaceTrace Security Team Report

Assessment date: 2026-08-30  
Mode: passive source and test review  
Pentest gate: **BLOCK**  
Red-team gate: **BLOCK**

`BLOCK` means remediation and re-review are required. It is not a vulnerability verdict or permission to test external systems.

## Executive Summary

Six independent read-only specialist sessions reviewed SurfaceTrace. Three specialists found five actionable issues: two high severity and three medium severity. The replay execution boundary itself was assessed positively: exact preview and approval, one-time tokens, manual redirects, no retries, and fail-closed rate/stop checks are implemented. The main product risk is that the Fastify API currently relies on a trusted local/single-user deployment assumption rather than enforcing caller authentication or project ownership. The new security-team gate also has two integrity bypasses that must be fixed before its PASS result should be trusted.

## Findings

### High: Management routes have no authentication or authorization guard

The server exposes project, scope, HAR import, inventory, experiment, asset, trust-boundary, evidence, and identity endpoints without a caller identity or authorization middleware. Examples are in `packages/server/src/app.ts:338-483` and `packages/server/src/app.ts:998-1469`.

Recommendation: add an explicit authentication boundary and authorize every state-changing and data-bearing route against an authenticated principal. Until then, bind the server to loopback and document the trusted single-user deployment constraint prominently.

### High: Team gate trusts a mutable agent roster

The gate iterates `manifest.agents`, but that roster is not included in the scope hash and is not compared with the canonical three-agent team. Removing agents from the manifest can allow fewer than three receipts to reach PASS (`scripts/security-team.mjs:47-76`).

Recommendation: derive the expected roster from `TEAMS[manifest.team]`, compare it exactly with the manifest, and bind it into the hashed manifest contract.

### Medium: Project and observation tenant isolation is absent

`GET /projects` lists all projects, opening a project swaps global active state, and identity assignment accepts any known observation/identity pair without ownership checks (`packages/server/src/app.ts:128-170`, `packages/server/src/app.ts:346-370`, `packages/server/src/app.ts:1025-1047`).

Recommendation: if SurfaceTrace will support remote or multi-user use, model workspace ownership and enforce it for project enumeration, opening, evidence access, observations, and identity mutation. If not, make single-user loopback-only deployment an enforced invariant.

### Medium: Evidence ledger does not verify record IDs

Ledger verification recomputes `prevHash` and `contentHash`, but does not verify that `record.id` still equals the ID derived during append (`packages/core/src/evidence/ledger.ts:20`, `packages/core/src/evidence/ledger.ts:41`). An ID-only mutation can therefore break provenance references without invalidating the chain.

Recommendation: verify `id === contentHash.slice(0, 24)`, or include the record ID in the hashed payload and reject mismatches. Add an ID-tampering regression test.

### Medium: Team PASS can contain failed or untested checks

The gate requires a receipt-level PASS and non-empty evidence strings, but ignores `checks[].result`. A PASS receipt may contain FAIL or NOT_TESTED checks and still pass (`scripts/security-team.mjs:71-73`).

Recommendation: validate receipts against the JSON schema and require every mandatory check to be PASS. A FAIL check should BLOCK; a required NOT_TESTED check should also BLOCK or produce an explicit incomplete outcome.

## Positive Controls

- Active replay requires explicit preview and approval and consumes single-use tokens.
- Scope, rate, and stop conditions are checked again immediately before sending.
- The HTTP client performs one request, disables automatic redirects, and has no retry loop.
- HAR import and replay response handling apply redaction before persistence.
- Identity replay requires explicitly supplied runtime credential material.
- Agent runs default to passive review, and active team mode accepts loopback targets only.

## Team Results

| Agent | Status | Findings |
|---|---:|---:|
| access-control-tester | FAIL | 2 |
| replay-safety-tester | PASS | 0 |
| evidence-integrity-tester | FAIL | 1 |
| abuse-case-analyst | PASS | 0 |
| agentic-threat-analyst | PASS | 0 |
| defense-evasion-analyst | FAIL | 2 |

## Limitations

- This was passive source review; agents sent no network traffic and performed no exploitation.
- Several agent sandboxes could not run npm through their restricted Windows environment. The parent verification run had already passed SurfaceTrace core (115), server (29), web (9), and team-runner (3) tests.
- Findings about tenant isolation depend on intended deployment. They are high impact for remote/multi-user use and an explicit architectural constraint for localhost-only single-user use.
- A gate PASS would still not authorize release; human review remains the final authority.

## Recommended Order

1. Fix the team gate roster and check-result bypasses, then rerun both teams so their gate is trustworthy.
2. Decide and enforce SurfaceTrace's deployment boundary: authenticated multi-user service or loopback-only single-user tool.
3. Add evidence-record ID verification and a tampering regression test.
4. Rerun both six-agent reviews and require both deterministic gates to PASS.
