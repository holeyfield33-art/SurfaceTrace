# SurfaceTrace

SurfaceTrace is a human-in-the-loop attack-surface investigation cockpit for authorized web security testing.

It organizes captured traffic into redacted observations, identities, threat context, hypotheses, controlled comparisons, deterministic diffs, and hash-linked evidence. SurfaceTrace complements browser developer tools and interception proxies; it is not a replacement for Burp Suite or Caido.

## Workflow

```text
Capture authorized traffic
-> Import HAR
-> Inspect redacted HTTP
-> Parse endpoints and inputs
-> Assign identities
-> Map assets and trust boundaries
-> Form hypotheses
-> Select a known baseline
-> Change exactly one variable
-> Pass scope, rate, and stop gates
-> Preview the exact redacted outbound request
-> Explicitly approve one request
-> Capture the redacted response
-> Deep deterministic diff
-> Record a human conclusion and hash-linked evidence
```

Imported-observation comparisons remain passive. Active replay is a separate, prominently labeled operation that requires configured scope and a fresh human approval for every outbound request.

## Capability Matrix

| Capability | Status |
| --- | --- |
| HAR import | Implemented |
| Raw HTTP inspection | Implemented |
| Parsed inputs | Implemented |
| Identity assignment | Implemented |
| Cross-identity comparison | Implemented |
| Experiment notebook | Implemented |
| Nested deterministic diff | Implemented |
| Threat mapping | Implemented |
| SSRF reasoning signals | Implemented |
| SQLite persistence | Implemented |
| Scope enforcement | Implemented |
| Rate/stop enforcement | Implemented |
| Human-approved replay | Implemented |
| Automatic redirects | Not implemented by design |
| Bulk replay/fuzzing | Not implemented by design |
| Autonomous exploitation | Non-goal |
| AI vulnerability verdicts | Non-goal |

## Safety Model

1. Authorization comes first.
2. Missing or invalid scope fails closed: no valid scope means no execution.
3. Every controlled experiment declares exactly one mutation.
4. One explicit approval sends exactly one request.
5. Redirects are not followed automatically and require a new approval.
6. Requests are never retried automatically.
7. Rate limits and stop conditions fail closed and are rechecked before sending.
8. Secrets are redacted before persistence or evidence creation.
9. Identity assignments are explicit and manual; replay credentials are runtime-only.
10. Hypotheses and deterministic signals are not vulnerability verdicts.
11. Conclusions remain human-controlled.
12. There is no bulk replay, fuzzing, crawling, payload spray, or automated exploitation.

SurfaceTrace also excludes internet-wide scanning, payload libraries, automatic attack generation, AI vulnerability verdicts, and cloud collection of raw sessions.

## Tool Roles

| Tool | Role |
| --- | --- |
| Browser / DevTools | Observe application behavior and export authorized traffic |
| Burp Suite / Caido | Capture traffic and perform manual HTTP manipulation |
| SurfaceTrace | Investigate, map threats, run controlled one-request replay, compare deterministically, and preserve evidence |

## Current Testing Readiness

### Good fit now

- Hacker101 CTF exercises
- Authorized bug-bounty targets
- Access-control investigations
- Account A / Account B and anonymous / authenticated comparisons
- SSRF investigation organization and review questions
- Manual one-request-at-a-time replay
- Evidence collection and restart-safe investigation records

### Not supported by design

- Crawlers or scanners
- Fuzzing engines or payload sprays
- Autonomous exploitation
- Bulk ID iteration or batch replay
- Automatic redirects or retries
- Automatic attack generation or vulnerability verdicts

## Getting Started

Use Node 22 as specified by `.nvmrc`.

```bash
npm install
npm test
npm run typecheck
npm run build
```

The Docker service is a development container and starts idle. Build it on first use, then verify the exact repository state:

```bash
docker compose up -d --build
docker compose up -d
docker compose ps
docker compose exec surfacetrace npm install
docker compose exec surfacetrace npm test
docker compose exec surfacetrace npm run typecheck
docker compose exec surfacetrace npm run build
```

Start the API and web UI in separate terminals:

```bash
docker compose exec surfacetrace npm run dev
docker compose exec surfacetrace npm run dev:web -- --host 0.0.0.0
```

The web UI is available at `http://localhost:5173`. Its Vite proxy sends `/api` requests to the Fastify API at `http://localhost:8787`. Both ports are published by `docker-compose.yml`.

Server state defaults to `./data/surfacetrace.db`. Set `SURFACETRACE_DB_PATH` to override it; Docker Compose mounts the `surfacetrace-data` volume at `/workspace/SurfaceTrace/data`.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Canonical tester workflow](docs/WORKFLOW.md)
