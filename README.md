# SurfaceTrace

SurfaceTrace is a human-in-the-loop attack-surface investigation cockpit for authorized web security testing. It turns captured HTTP traffic into redacted observations, normalized endpoints and inputs, identity and threat context, one-variable experiments, deterministic diffs, and hash-linked evidence. It supports passive imported comparisons and one-request-at-a-time active replay with fail-closed scope checks and explicit human approval.

## Who It Is For

SurfaceTrace is for learners and testers who want a structured method for understanding web traffic, reviewing access-control and trust questions, comparing one controlled change, and keeping a reproducible investigation notebook. It complements browser DevTools, Burp Suite, and Caido; it is not a scanner or proxy replacement.

> Use SurfaceTrace only with systems you own or have explicit permission to test. Missing active scope means no execution. The product has no crawler, bulk replay, automatic retries, automatic redirects, autonomous exploitation, or automatic vulnerability verdicts.

## Quick Start

Use Node 22 as specified by `.nvmrc`.

```bash
npm install
npm test
npm run typecheck
npm run build
```

- `npm install` installs the root and workspace dependencies recorded by the repository. Success means npm exits without an installation error.
- `npm test` runs the core, server, and web test suites. Use it to confirm behavior before starting an investigation.
- `npm run typecheck` asks TypeScript to validate all workspaces without changing source files.
- `npm run build` compiles the server/core packages and creates the web production bundle. A completed Vite build is the final success signal.

Start the API and web UI in separate terminals:

```bash
npm run dev
npm run dev:web
```

`npm run dev` starts Fastify on port `8787`; keep that terminal open. In a second terminal, `npm run dev:web` starts Vite on port `5173` and proxies browser API calls to Fastify. Stop either process with `Ctrl+C` in its terminal.

Open `http://localhost:5173`. API health is available at `http://127.0.0.1:8787/health`.

## Course and Run Manual

**[Full beginner course and run manual -> docs/COURSE_AND_RUN_MANUAL.md](docs/COURSE_AND_RUN_MANUAL.md)**

The manual covers installation, a complete guided session using `fixtures/sample.har`, HTTP and security-review concepts, passive comparison, bounded active replay, ethics, troubleshooting, API routes, and every fixture entry.

## Repository Layout

```text
packages/core/       Pure HAR, redaction, graph, scope, diff, and evidence logic
packages/server/     Fastify API, SQLite persistence, and bounded replay executor
packages/web/        React investigation cockpit and contextual classroom
fixtures/sample.har  Synthetic passive-learning traffic
docs/                Architecture, canonical workflow, and complete course/manual
docker-compose.yml   Optional development-container service
```

## Status and License

Implementation is complete through P9: raw HTTP inspection, identity investigation, experiment notebook, deterministic deep diff, threat mapping, SSRF reasoning signals, SQLite persistence, runtime scope enforcement, and human-approved active replay.

Licensed under Apache-2.0.
