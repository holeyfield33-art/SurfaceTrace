# SurfaceTrace Architecture

SurfaceTrace is a local-first, deterministic investigation cockpit. Core security decisions are pure TypeScript, the Fastify server owns persistence and outbound execution, and the React UI keeps passive evidence separate from active requests.

## Module Boundaries

```text
packages/
  core/       Pure HAR, redaction, graph, hypothesis, experiment, diff, evidence, and scope logic
  server/     Bounded local API, server-owned SQLite, and the dedicated replay executor
  web/        React investigation cockpit, experiment notebook, and static learning layer
fixtures/     Authorized synthetic traffic used by tests and demonstrations
docs/         Architecture and canonical tester workflow
```

Only `packages/server/src/replay/httpClient.ts` performs replay network I/O. Arbitrary routes do not create their own HTTP clients.

## Investigation Pipeline

```text
HAR / imported traffic
        |
        v
redaction
        |
        v
normalization
        |
        v
observations / endpoints / inputs
        |
        v
server-owned SQLite
        |
        v
identity / assets / trust boundaries
        |
        v
hypotheses
        |
        v
experiment notebook
        |
        v
request reconstruction
        |
        v
scope + rate + stop gates
        |
        v
human preview + explicit approval
        |
        v
dedicated HTTP executor
        |
        v
redacted response capture
        |
        v
deep deterministic diff
        |
        v
hash-linked evidence
```

Passive comparisons stop at the experiment notebook and compare two imported observations without network activity. Active replay continues through reconstruction and all execution gates.

## Canonical Data

Imported requests become redacted `Observation` records, deterministic endpoint templates, and value-free input descriptors. Supported input locations are path, query, selected headers, cookies, JSON bodies, and form bodies. Raw query secrets, cookies, credential headers, and sensitive body values do not enter canonical persistence or evidence.

Identity assignments are manual. Assets and trust boundaries are manual annotations. Hypotheses and SSRF reasoning are deterministic, inferred review prompts rather than findings or vulnerability verdicts.

## State And Storage

SQLite is owned by the Fastify server. The persistence adapter stores canonical redacted observations together with projects, imports, endpoint/input inventories, identity assignments, threat annotations, hypotheses, experiments, deep diffs, project scope, and exact hash-linked evidence records.

The database has an explicit schema version and supported migrations. Known versions migrate non-destructively; unknown versions fail clearly. Investigation state and evidence-chain integrity are restored and verified after server restart. Runtime replay credentials are deliberately excluded from SQLite and must be supplied again after restart.

`SURFACETRACE_DB_PATH` selects the database path and defaults to `./data/surfacetrace.db`. Browser-only lesson proficiency and current UI context remain in local browser storage.

## Active Replay Boundary

Replay reconstruction starts only from a known imported baseline and preserves its method, URL, safe headers, query, and body except for one mutation accepted by `assertOneVariable()`. Identity replay additionally requires runtime credential material explicitly associated with the target identity.

Preparation performs no network activity. It canonicalizes the candidate, evaluates configured scope and stop state, checks rate availability, and returns an exact redacted preview. The preview token is single-use. On `SEND THIS REQUEST`, the server rechecks every gate, consumes rate budget only immediately before execution, deletes the token, and sends exactly one request.

The dedicated executor:

- accepts HTTP and HTTPS only;
- rejects malformed URLs;
- disables automatic redirect following;
- uses a bounded timeout;
- enforces a bounded response-body size and records truncation;
- performs no automatic retries.

A redirect `Location` is redacted and evaluated independently through the scope engine. It is displayed only as a proposed target and cannot be followed without a new preview and approval.

## Diff And Evidence

Replay responses cross the existing redaction boundary before becoming observations. The existing deep-diff implementation compares status, headers, nested body fields, arrays, types, and truncation state. SurfaceTrace does not maintain a parallel replay-history subsystem: approval metadata, response observations, diffs, conclusions, and evidence attach to the existing experiment notebook model.

Evidence is logically append-only and hash-linked. Replay appends distinct records for preparation, scope decision, human approval, request sent, response received, and diff creation. Persistent evidence never contains runtime credential values.

## Safety Invariants

1. Authorization is established before traffic enters an investigation.
2. Missing or invalid scope produces zero outbound requests.
3. Controlled experiments contain exactly one declared mutation.
4. One explicit approval sends one request.
5. Redirects require a new approval.
6. There are no automatic retries.
7. Rate and stop conditions fail closed.
8. Secrets are redacted before persistence and evidence.
9. Identity assignments and credential associations are explicit.
10. Hypotheses and SSRF signals are not vulnerability verdicts.
11. Conclusions remain human-controlled.
12. Bulk replay, fuzzing, crawling, scanning, and autonomous exploitation are excluded.

## Runtime Topology

The web development server listens on port `5173` and proxies `/api` to Fastify on port `8787`. Docker Compose publishes both ports, mounts the workspace, keeps dependencies in a named volume, and persists SQLite data in the `surfacetrace-data` volume.

## Explicit Non-Goals

SurfaceTrace does not provide autonomous exploitation, internet-wide scanning, bulk fuzzing, payload libraries, cloud collection of raw sessions, AI vulnerability verdicts, automatic redirects, or retry loops.

## Controlled Replay Lab

The repository also includes `examples/controlled-replay-lab/`, a separate teaching app for replay practice. It is intentionally outside the SurfaceTrace production server boundary and exists only to demonstrate localhost-only route behavior, deterministic comparison objects, redirect handling, slow-response timing, and bounded large responses in a synthetic environment.

The lab is not wired into the Fastify API, SQLite persistence, or the SurfaceTrace web UI. It should be started explicitly with its own command and is expected to stay on loopback unless an operator deliberately opts into an unsafe override.
