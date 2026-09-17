# SurfaceTrace Changelog

## 2026-09-16 — Provenance and release-doc reconciliation

- Reconciled the repository state to the verified main branch and cleaned local generated artifacts from the working tree.
- Updated the release documentation to reflect the actual checked-in behavior, including the current known limitations around one-variable experiment classification and evidence-chain verification.
- Added explicit provenance and verification notes to the workflow and release-facing documentation so the branch state, repo history, and user-facing guidance remain aligned.
- Kept the runtime behavior scope explicit: the tool remains a local-only, single-user investigation workflow with loopback-only execution and no automatic retries or autonomous exploitation.

## 2026-09-02 — Security hygiene and release hardening

- Fixed the prior release blockers around project isolation, scope-encoding bypass, HAR redaction, evidence-tamper detection, replay preview integrity, and malformed request handling.
- Restored the local development flow and the canonical replay boundary to a fail-closed design with explicit approvals and rate/risk guards.
- Documented the remaining known gaps in a transparent, audit-friendly manner rather than over-claiming completion.

## 2026-08-30 — Launch remediation and verification pass

- Re-ran the core verification and remediation sequence for the launch-ready build.
- Tightened the release narrative around local-only security boundaries and runtime validation.
- Confirmed that the product remains education-first and human-controlled rather than an autonomous exploitation platform.
