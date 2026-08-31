# SurfaceTrace

SurfaceTrace is a human-in-the-loop attack-surface investigation cockpit for authorized web security testing. It turns captured HTTP traffic into redacted observations, normalized endpoints and inputs, identity and threat context, one-variable experiments, deterministic diffs, and hash-linked evidence. It supports passive imported comparisons and one-request-at-a-time active replay with fail-closed scope checks and explicit human approval.

## Who It Is For

SurfaceTrace is for learners and testers who want a structured method for understanding web traffic, reviewing access-control and trust questions, comparing one controlled change, and keeping a reproducible investigation notebook. It complements browser DevTools, Burp Suite, and Caido; it is not a scanner or proxy replacement.

> Use SurfaceTrace only with systems you own or have explicit permission to test. Missing active scope means no execution. The product has no crawler, bulk replay, automatic retries, automatic redirects, autonomous exploitation, or automatic vulnerability verdicts.

## Quick Start

Use Node 22 as specified by `.nvmrc`. SurfaceTrace enforces Node 22 because the SQLite adapter uses a native binary that must match the Node version used during installation.

```bash
npm install
npm run lint
npm test
npm run typecheck
npm run build
npm run e2e:install
npm run e2e
```

- `npm install` installs the root and workspace dependencies recorded by the repository. Success means npm exits without an installation error.
- `npm test` runs the core, server, and web test suites. Use it to confirm behavior before starting an investigation.
- `npm run typecheck` asks TypeScript to validate all workspaces without changing source files.
- `npm run build` compiles the server/core packages and creates the web production bundle. A completed Vite build is the final success signal.
- `npm run e2e` builds the application and runs the guarded Chromium workflow against isolated synthetic loopback services. Unit/integration, browser E2E, replay-lab, and security-team gates are separate checks.

Start the API and web UI in separate terminals:

```bash
npm run dev
npm run dev:web
```

To practice the replay lesson boundary in isolation, start the teaching lab separately:

```bash
npm run lab
```

`npm run dev` starts Fastify on port `8787`; keep that terminal open. In a second terminal, `npm run dev:web` starts Vite on port `5173` and proxies browser API calls to Fastify. Stop either process with `Ctrl+C` in its terminal.

If all three server test suites fail with `NODE_MODULE_VERSION` or `better_sqlite3.node`, your terminal is using a different Node version from the one that installed dependencies. Run `node --version`; it must report Node 22. If you use a Node version manager, select the supported runtime and repair the native installation with:

```bash
nvm use 22
node --version
npm install
npm test
```

On the current SurfaceTrace Windows workstation, the equivalent PowerShell selection is `$env:PATH = "$env:USERPROFILE\.toolchains\node-v22.23.2-win-x64;$env:PATH"`. This fallback is machine-specific; other contributors should use their own Node manager or Node 22 installation. `npm install` ensures native dependencies match the selected runtime, and `npm test` confirms the repair. Do not rebuild dependencies under Node 24 and then return to Node 22; switching runtimes recreates the same native ABI mismatch.

Open `http://localhost:5173`. API health is available at `http://127.0.0.1:8787/health`.

SurfaceTrace is a single-user local tool, not a multi-tenant service. The API and Vite UI bind to loopback by default, and Docker publishes only the web proxy on host loopback. If `SURFACETRACE_API_TOKEN` is configured, every protected API request requires it, including requests arriving over loopback; the Vite development proxy reads the token at runtime and adds it server-side without compiling it into browser JavaScript. Project, observation, identity, and evidence state all belong to one local operator workspace; non-loopback UI exposure and shared multi-user deployment are unsupported.

In a normal local Windows workspace, these are direct loopback listeners and may not appear in VS Code's **Ports** forwarding panel. That panel is mainly relevant when VS Code is attached to a Dev Container, WSL, SSH host, or Codespace. Verify that both `LocalAddress` values are `127.0.0.1` with `Get-NetTCPConnection -LocalPort 5173,8787 -State Listen`. If a start command exits after the Node-version check, no listener will be created; select Node 22 and run the command again.

Forwarding headers such as `X-Forwarded-For` and `Forwarded` are not trusted authentication evidence. The development and preview proxies may inject a configured API token server-side, but a loopback proxy hop never converts an unauthenticated remote caller into a trusted caller. Non-loopback UI exposure is unsupported. Before authorized testing, inspect active listeners and Windows Firewall rules; do not assume that a browser URL, VS Code port panel, container mapping, or host firewall is private by default.

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
