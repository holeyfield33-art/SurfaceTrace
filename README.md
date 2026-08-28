# SurfaceTrace

**Human-in-the-loop attack-surface and threat-mapping cockpit.**

Browse an authorized application normally. Get a graph of endpoints, inputs, identities, sensitive data paths, trust boundaries, hypotheses, experiments, and evidence.

> This is **not** another vulnerability scanner.  
> It is a disciplined workflow tool that turns captured traffic into a living threat model and forces one-variable-at-a-time testing with reproducible evidence.

---

## Core Promise

```
Browser action
  → Endpoint
    → Request inputs
      → Identity/session context
        → Backend/service
          → Data asset
            → Response/output

Threat hypothesis
  → One controlled mutation
    → Evidence record
      → Result: same / different / needs review
```

SurfaceTrace preserves the full chain:

**observed request → mapped trust boundary → threat hypothesis → one-variable experiment → response diff → evidence**

---

## Why This Exists

Existing tools give you pieces:

| Tool              | Strength                          | Gap                                      |
|-------------------|-----------------------------------|------------------------------------------|
| Caido / Burp      | Traffic capture, history, sitemap | No threat model or guided experiments    |
| OWASP Threat Dragon | Data-flow diagrams + STRIDE     | Disconnected from live traffic           |
| ZAP               | Repeatable automated scans        | Not human-in-the-loop threat mapping     |

SurfaceTrace sits **above** capture tools. It turns passive history into an interactive attack-surface graph and walks the tester through disciplined review.

---

## Features (MVP Roadmap)

### 1. Scoped Target
- Explicit authorization confirmation
- Allowed domains / paths
- Test accounts & roles
- Rate limits and safe-method policy
- Out-of-scope exclusions and stop conditions

### 2. Traffic Ingestion
- HAR import (primary)
- Future: Caido / Burp / mitmproxy adapters
- Immediate secret redaction

### 3. Attack Surface Graph
Node types:
- **Endpoint** — method, host, path template, status distribution, auth requirement
- **Input** — query, JSON field, form field, header, cookie, path segment
- **Identity context** — anonymous / user / admin / session state
- **Asset** — PII, payment data, API keys, internal IDs, documents
- **Trust boundary** — browser↔API, public↔authenticated, user↔admin, app↔third-party
- **Observation** — redacted request/response metadata
- **Hypothesis** — defensive test questions
- **Experiment** — single approved mutation from baseline
- **Finding candidate** — reproducible behavior + evidence

Visual language:
- Blue = components / endpoints
- Purple = identities & auth boundaries
- Yellow = user-controlled inputs
- Red = sensitive assets / high-impact actions
- Orange edges = external integrations / admin transitions
- Gray edges = observed traffic
- Dashed = inferred (needs confirmation)

### 4. Threat Mapping (the centerpiece)
- Zoomable graph canvas
- STRIDE-inspired review questions generated from observed signals
- Priority scoring focused on *review urgency*, not fake exploitability:

```
Priority = Asset sensitivity
         + Privilege boundary
         + Exposure
         + Input control
         + Change signal
         - Observed mitigation
```

### 5. One-Variable Discipline
When you open a captured request the UI locks the baseline and forces you to declare:

> **What single thing are you changing?**

Only one approved category of mutation is allowed. Everything else stays identical. The system records the exact delta and compares responses deterministically.

### 6. Diff & Evidence Ledger
- Status, length, headers, redirects, JSON shape diffs
- Field-level additions / removals / type changes
- Append-only, hash-linked evidence records (SHA-256 over canonicalized redacted data)
- Exportable markdown / JSON evidence packages

---

## Architecture (v1 — local-first)

| Component            | Responsibility                                      |
|----------------------|-----------------------------------------------------|
| Capture importer     | HAR (later proxy exports); redact secrets           |
| Normalizer           | Route templates, inputs, response metadata, auth    |
| Graph engine         | Nodes, edges, clustering of parameterized routes    |
| Threat mapper        | Trust boundaries, assets, STRIDE prompts            |
| Experiment runner    | Clone baseline, one mutation, scope/rate enforcement|
| Diff engine          | Deterministic baseline vs experiment comparison     |
| Evidence ledger      | Hash-linked, append-only observations & notes       |
| Guidance layer       | Next *review step* suggestions (advisory only)      |
| Report generator     | Redacted evidence packages                          |

**Tech choices (planned)**
- Frontend: React + TypeScript + React Flow / Cytoscape.js
- Backend: Node.js / Fastify (local)
- Storage: SQLite
- Import: HAR first
- Evidence: SHA-256 over canonicalized records
- AI: optional and advisory only — never owns redaction, scope, rate limits, or diffs

---

## Build Order

1. **HAR import → endpoint inventory**  
   Route normalization, inputs, responses, auth metadata, redaction.

2. **Interactive graph**  
   Endpoint → input → asset relationships + manual trust-boundary annotations.

3. **Threat cards**  
   STRIDE-inspired questions, checklist state, evidence links, mitigation notes.

4. **Baseline / experiment diff**  
   Clone request, change one approved field, compare deterministically.

5. **Evidence export**  
   Markdown report, graph JSON, redacted HAR reference, hashes.

6. **Proxy integration**  
   Caido / Burp / mitmproxy ingestion once the standalone HAR path is solid.

7. **Optional ZAP annotations**  
   Consume scanner results as graph notes for in-scope targets only.

---

## Explicit Non-Goals (v1)

- Autonomous exploitation
- Internet-wide discovery
- Blind active scanning of arbitrary URLs
- “AI says vulnerable” severity labels
- Browser credential collection
- Large vulnerability payload libraries
- Multi-user cloud hosting of raw captured sessions

Support **authorized, local capture + visual mapping + tester-approved experiments** only.

---

## Getting Started (once code lands)

```bash
git clone https://github.com/holeyfield33-art/SurfaceTrace.git
cd SurfaceTrace
# instructions will appear here as the MVP is built
```

---

## Inspiration & Alignment

- OWASP Attack Surface Analysis Cheat Sheet
- OWASP Web Security Testing Guide (WSTG)
- OWASP Threat Dragon (data-flow + STRIDE)
- Deterministic evidence & provenance patterns (Aegis / Aletheia lineage)

---

## License

TBD (likely Apache-2.0 or similar permissive license once initial code is committed).

---

**Status:** Repository initialized. Core vision and architecture documented. Implementation starting with HAR importer + graph engine.
