# SurfaceTrace

An evidence-driven web-security investigation command center with an integrated learning system.

## What this is

SurfaceTrace helps you import authorized HTTP traffic, normalize it into investigation-friendly structure, preserve hash-linked evidence, and connect what you observe to short lessons that build web-security reasoning over time.

## Implemented today

- Bounded HAR import with malformed-entry tolerance and HTTP/HTTPS-only URLs
- Pre-normalization redaction for query secrets, sensitive headers, cookies, and body shapes
- Unified path, query, JSON body, form, header, and cookie input descriptors
- Deterministic endpoint clustering, review hypotheses, one-variable guards, diffs, and hash-linked evidence
- Guided investigation loop comparing two imported observations against one declared input change
- Local Fastify API with a development-origin CORS allowlist
- Versioned local SQLite persistence with restart-safe evidence integrity
- Fail-closed project scope configuration and non-network candidate previews
- Command Center, Investigation, Classroom, and Evidence navigation
- Complete six-track curriculum manifest with representative 15-minute lessons
- Deterministic signal-to-lesson recommendations and local proficiency state
- Automated core tests and a three-OS GitHub Actions workflow

## Planned later

- Controlled experiment runner
- Interactive React Flow investigation graph
- Remaining full curriculum prose
- Redacted evidence export

## Safety boundaries

- Local-first design
- Authorized targets only
- No autonomous active scanning
- No cloud upload of raw sessions
- Evidence remains hash-linked and append-only
- Observations, hypotheses, experiments, evidence, and conclusions remain distinct
- No active request execution until the controlled experiment runner exists
- Current experiments compare previously imported authorized captures; they do not transmit traffic
- Scope previews and redirect decisions evaluate candidates but never contact them

## Local development

Use Node 22 (see `.nvmrc`).

```bash
npm install
npm run build
npm test
```

With Docker (Node, Git, Python, native build tools, curl, jq, and OpenSSL are included):

```bash
docker compose up -d --build
docker compose exec surfacetrace npm install
docker compose exec surfacetrace npm run build
```

Start the API and web UI in separate terminals:

```bash
docker compose exec surfacetrace npm run dev
docker compose exec surfacetrace npm run dev:web
```

Server state is stored at `./data/surfacetrace.db` by default. Override it with
`SURFACETRACE_DB_PATH`; Docker Compose mounts the `surfacetrace-data` volume at
the configured path.

The API is available at `http://localhost:8787` and the web UI at
`http://localhost:5173`. VS Code can also open the same service through the
included Dev Container configuration.
