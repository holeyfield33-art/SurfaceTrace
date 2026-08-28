# SurfaceTrace Architecture (v1)

Local-first, deterministic core with an optional advisory guidance layer.

## Module Boundaries

```
surfacetrace/
├── packages/
│   ├── core/                 # pure TypeScript domain logic (no UI, no network)
│   │   ├── har/             # HAR parser + normalizer
│   │   ├── graph/           # nodes, edges, route templating
│   │   ├── threat/          # boundaries, assets, priority scoring, STRIDE prompts
│   │   ├── experiment/      # baseline lock + one-variable mutation rules
│   │   ├── diff/            # deterministic response comparison
│   │   └── evidence/        # hash-linked ledger (SHA-256)
│   ├── server/               # Fastify local API + SQLite
│   └── web/                  # React + TypeScript + React Flow canvas
├── fixtures/                 # sample redacted HARs for tests
└── docs/
```

## Data Flow

1. **Import** — HAR (or future proxy export) enters the importer.
2. **Redact** — secrets stripped before any persistence.
3. **Normalize** — requests become endpoint templates + input descriptors.
4. **Graph** — nodes/edges materialize; trust boundaries can be annotated.
5. **Hypothesize** — signals generate review questions (not exploit payloads).
6. **Experiment** — tester declares exactly one change; system clones & mutates.
7. **Diff** — pure comparison produces a structured card.
8. **Ledger** — observation + experiment + diff + notes are hashed and appended.
9. **Export** — redacted evidence package (markdown + JSON + hashes).

## Invariants

- Redaction happens before storage.
- Scope and rate limits are enforced in code, not by hope.
- Diffs and evidence hashes are deterministic.
- AI (if present) is advisory only and never decides vulnerability or severity.
- No autonomous active scanning in v1.

## Storage

SQLite for v1. Graph can live in ordinary relational tables; a later migration to a dedicated graph store is optional.

## Security Posture of the Tool Itself

- Local-only by default.
- No cloud upload of raw sessions.
- Explicit authorization record required before any experiment can be run.
- Stop conditions (production impact, real-user data) are first-class.
