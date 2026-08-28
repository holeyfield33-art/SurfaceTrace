# SurfaceTrace Tester Workflow

This document mirrors the original brainstorm flowchart and is the canonical process the UI will enforce.

```
START
  │
  ▼
Identify target (authorized scope only)
  │
  ▼
Browse normally (or import HAR)
  │
  ▼
Capture / import requests
  │
  ▼
Inventory endpoints
  │
  ▼
Inventory inputs
  │
  ├────────────┬────────────┐
  │                       │
  ▼                       ▼
REQUEST                 RESPONSE
method/path             status/body
params/body             headers/links
cookies                 scripts/comments
  │                       │
  └────────────┴────────────┘
                  │
                  ▼
         Build attack surface graph
                  │
                  ▼
            Form hypotheses
                  │
                  ▼
         Change ONE variable only
                  │
                  ▼
             Send request
                  │
                  ▼
           Compare response
                  │
      ├───────────┬───────────┐
      │                       │
   Different?               Same?
      │                       │
      ▼                       ▼
 Investigate              Move on
      │
      ▼
   Record evidence + next hypothesis
      │
      ▼
    Repeat
```

## Rules the product enforces

1. **Scope first** — no traffic leaves the defined target boundaries.
2. **Baseline lock** — every experiment starts from a known, redacted baseline request.
3. **One variable** — the UI refuses to send a request that differs in more than one approved dimension.
4. **Deterministic diff** — comparison is code-driven, never an opaque AI judgment.
5. **Evidence append-only** — every observation, mutation, and result is hashed and chained.

## Example experiment card

```
Baseline:  GET /api/projects/100
Experiment: GET /api/projects/200
Changed:   path.projectId only
Identity:  same session / same role
Result:    200 with different project data + ownerEmail field
Status:    investigate — ownership check required
Evidence:  sha256:...
```
