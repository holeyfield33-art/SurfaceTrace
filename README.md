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

Start the API, web UI, and controlled replay lab together:

```bash
npm run dev:all
```

`npm run dev:all` keeps all three services in one foreground process and stops the remaining services if any one exits. For focused development, `npm run dev`, `npm run dev:web`, and `npm run lab` still start the API, UI, and lab individually.

Open `http://localhost:5173`. The UI proxy exposes API health at `http://localhost:5173/api/health` and the controlled lab at `http://localhost:5173/lab/projects/100`. Direct loopback health remains available at `http://127.0.0.1:8787/health`.

### Codespaces and Dev Containers

Opening the repository in its development container starts `npm run dev:all` automatically. Ports `5173`, `8787`, and `4040` are labeled and forwarded; port `5173` is the supported browser entry point and proxies `/api` and `/lab` to the loopback-only services inside the container. Vite admits only localhost, Codespaces hostnames on the current forwarding domain, and explicitly configured hosts.

Open only the **SurfaceTrace UI** (`5173`) port link. The API and Controlled Replay Lab port notifications are internal-only: they never serve a page, only a bare JSON health payload, so following either link is expected to look broken even when the container is healthy. Use them through the UI proxy instead, at `/api/health` and `/lab/projects/100`.

If you change `.devcontainer/devcontainer.json`, `docker-compose.yml`, or `Dockerfile`, reconnecting to an existing codespace or container is not enough — run **Rebuild Container** (Codespaces or Dev Containers command palette). Docker Compose only evaluates `${CODESPACE_NAME}`-style environment substitution once, at container creation, so a container created before such a change won't pick it up until it's rebuilt.

Keep every forwarded port **Private**. Codespaces ports are private by default, but repository configuration cannot override a user or organization visibility change. SurfaceTrace remains a single-user tool and is not safe for a public port or shared multi-user deployment.

### Docker Compose

Compose builds dependencies into the image, starts all three services, and waits on their health endpoints:

```bash
docker compose up -d --build
docker compose ps
```

Only `127.0.0.1:5173` is published to the host. Use `http://127.0.0.1:5173/api/health` and `http://127.0.0.1:5173/lab/projects/100`; API port `8787` and lab port `4040` remain on container loopback. `docker compose down` stops the services without deleting the named data volume.

If all three server test suites fail with `NODE_MODULE_VERSION` or `better_sqlite3.node`, your terminal is using a different Node version from the one that installed dependencies. Run `node --version`; it must report Node 22. If you use a Node version manager, select the supported runtime and repair the native installation with:

```bash
nvm use 22
node --version
npm install
npm test
```

### Windows PowerShell

For Docker use, open a terminal in this repository and run `docker compose up -d --wait`.
Open `http://127.0.0.1:5173`; stop it with `docker compose stop`. Docker supplies
Node 22 and keeps its dependencies and database in separate named volumes.

For native Windows development, the helper uses Node 22 already on PATH or a
pinned toolchain under `%USERPROFILE%\.toolchains\node-v22.*-win-*`. It selects
that runtime ahead of other Node versions and invokes its matching `npm.cmd`.
From this repository in PowerShell:

```powershell
# First native setup, or repair after installing dependencies with another Node:
.\scripts\win-dev.ps1 -Install -UseOnly
node --version  # must be v22.x
npm test

# Stop Docker before native startup: both use port 5173.
docker compose stop
npm run dev:all
```

For subsequent native starts in a new terminal, run `npm run win:dev`. To select
Node 22 for other commands in the current PowerShell session, run
`.\scripts\win-dev.ps1 -UseOnly`. A command such as
`.\scripts\win-dev.ps1 -Script typecheck` also selects the runtime automatically.
The helper works from other directories because it runs npm at the repository
root. It does not change the machine's permanent PATH.

Do not run native and Docker development servers simultaneously. Native Windows
uses the local `data/` directory; Docker uses its named data volume. Switching
between them does not transfer investigation data. Do not install dependencies
under Node 24 and then return to Node 22; that recreates the native ABI mismatch.

SurfaceTrace is a single-user local tool, not a multi-tenant service. Local processes bind to loopback by default. Containers bind only Vite to the container interface required for forwarding, while API and lab processes remain on container loopback; Docker publishes only the web proxy on host loopback. If `SURFACETRACE_API_TOKEN` is configured, every protected API request requires it, including requests arriving over loopback; the Vite development proxy reads the token at runtime and adds it server-side without compiling it into browser JavaScript. Project, observation, identity, and evidence state all belong to one local operator workspace; public exposure and shared multi-user deployment are unsupported.

In a normal local Windows workspace, these are direct loopback listeners and may not appear in VS Code's **Ports** forwarding panel. That panel is mainly relevant when VS Code is attached to a Dev Container, WSL, SSH host, or Codespace. Verify the listeners with `Get-NetTCPConnection -LocalPort 5173,8787,4040 -State Listen`. If a start command exits after the Node-version check, no listener will be created; select Node 22 and run the command again.

Forwarding headers such as `X-Forwarded-For` and `Forwarded` are not trusted authentication evidence. The development and preview proxies may inject a configured API token server-side, but a loopback proxy hop never converts an unauthenticated remote caller into a trusted caller. Before authorized testing, inspect port visibility, active listeners, and firewall rules; do not assume that a browser URL, VS Code port panel, container mapping, or host firewall is private by default.

## Release Notes and Provenance

The repository has been reconciled to the current remote main branch, the local worktree has been cleaned of stray generated artifacts, and the release documentation now reflects the verified provenance state for the current release. See [CHANGELOG.md](CHANGELOG.md) for the public-facing summary of changes and status.

## Start learning

Open **CLASSROOM**, then **START OR CONTINUE THE BEGINNER COURSE**. The 24 guided lessons assume no coding or cybersecurity background. Each has an explanation, worked example, ordered exercise, expected result, troubleshooting, notebook prompt, answer, and AI tutor prompt. Learn DevTools and Burp before the optional GDK exercise. Progress stays in your browser.

The older 135-topic syllabus is available separately as short primers and outlines, not a prerequisite checklist. See [the beginner course guide](docs/BEGINNER_COURSE.md) and [how GDK fits](docs/GDK_GUIDE.md).

## Personal lab notes and scope

Use **NOTES** (or **OPEN MY LAB NOTES** on Command Center) for a reusable lab plan: target, identity, one change, request limit, stop condition, expected result, observed facts, inferences, and next question. Each lab is separate. Edits autosave in this browser at this origin; they are not server evidence and are not synced. Download a text copy before clearing browser storage or moving to another browser/address.

The Command Center scope panel includes field explanations and a local-lab walkthrough. **FILL LOCAL LAB EXAMPLE** only fills a draft. Review it, explicitly enable the local exercise if intended, and **SAVE SCOPE**. **CHECK SCOPE - NO NETWORK** checks the saved rules; it does not contact the candidate target. Only the separate active-replay preview and **SEND THIS REQUEST** workflow in Investigation sends a target request. Notes never configure scope automatically.

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

### Known Limitations

An adversarial re-verification pass (2026-09-02) confirmed the prior release-blocking issues around project isolation, scope-encoding bypass, HAR redaction, evidence-tamper detection, the replay-preview contract, and malformed-request handling are fixed and hold up under direct execution, not just static review. It also found the following issues, which are still open:

- **Controlled-experiment classification gap.** An experiment can be certified `"controlled"` (single-variable) despite a second undeclared change within the same mutation category, or an unrelated body change alongside a declared body-field mutation. See `docs/ARCHITECTURE.md` Safety Invariant 3 and `docs/WORKFLOW.md`.
- **Experiment "close" does not gate replay server-side.** The UI states that closing an experiment "will prevent further execution," but `/replay/prepare` and `/replay/:token/send` do not check experiment status; a closed experiment's baseline remains fully replayable and fires a real outbound request.
- **`ready_for_peer_review` is a self-attested free-text field.** It is not checked against the experiment's actual linked evidence records, so it can be set without any real supporting evidence.
- **Evidence-ledger canonicalization has a `__proto__`-keyed edge case.** `packages/core/src/evidence/hash.ts`'s key-sorting step silently drops a JSON key literally named `__proto__` before hashing, which is a real weakness in the hashing primitive. Redundant plain-string fields elsewhere in current payloads currently limit real-world impact, but the primitive itself should be hardened (e.g. build the sorted object with `Object.create(null)` instead of bracket assignment).

Licensed under Apache-2.0.
