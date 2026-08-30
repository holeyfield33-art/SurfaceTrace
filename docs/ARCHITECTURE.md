# SurfaceTrace Architecture

SurfaceTrace is a local-first, deterministic investigation command center with an integrated static learning layer.

## Module Boundaries

```text
packages/
  core/       Pure TypeScript HAR, graph, threat, experiment, diff, evidence, and scope logic
  server/     Bounded Fastify local API with versioned SQLite persistence
  web/        React cockpit, static curriculum, and contextual lesson mappings
fixtures/     Authorized, synthetic HAR data used by tests and demos
docs/         Architecture and workflow documentation
```

## Data Flow

1. Import: a HAR enters the bounded local API.
2. Redact: query secrets and sensitive request data are removed before observation creation or hashing.
3. Normalize: requests become endpoint templates and value-free input descriptors.
4. Map: endpoint, input, observation, and hypothesis relationships become graph data.
5. Hypothesize: deterministic signals generate security questions, never vulnerability claims.
6. Learn: deterministic mappings recommend static lessons for the current investigation context.
7. Preserve: normalized import summaries enter the append-only hash-linked evidence ledger.
8. Experiment: the tester chooses two imported observations and declares exactly one changed input.
9. Validate: the API verifies endpoint, hypothesis, input, and observation relationships before comparison.
10. Compare: a deterministic diff produces a `same` or `different` state and appends separate experiment and diff evidence records.
11. Gate: the scope engine evaluates a fully specified candidate or redirect target against explicit project rules without sending traffic.

## Input Model

Input descriptors contain a name, location, inferred type, endpoint relationship, sensitivity, and observed count. Supported locations are path, query, JSON body, form body, selected security-relevant headers, and cookies. Cookie values and sensitive values are never retained in descriptors.

## Invariants

- Redaction occurs before normalized storage and content hashing.
- Raw query and cookie secrets do not enter API inventory or evidence.
- Only HTTP and HTTPS observations are accepted.
- HAR byte and entry limits are configurable and enforced by the API.
- Malformed entries are skipped without discarding valid entries.
- Local API CORS permits configured local development origins only.
- Observations, hypotheses, experiments, evidence, and conclusions remain distinct.
- Diffs and evidence hashes are deterministic.
- No autonomous scanning or active request execution exists in this milestone; experiments compare imported captures only.
- Missing or invalid scope fails closed, and every proposed redirect target is evaluated independently.

## State And Storage

Investigation data is persisted by the server in a local, versioned SQLite database. The adapter stores only canonical redacted observations and preserves projects, imports, identity assignments, threat annotations, hypotheses, experiments, deep diffs, links, project scope, and exact append-only evidence records across restart. `SURFACETRACE_DB_PATH` selects the database path and defaults to `./data/surfacetrace.db`; supported migrations are non-destructive and unknown schema versions fail clearly. Lesson proficiency and current endpoint/lesson context continue to use local browser storage.

## Scope Boundary

The canonical core scope engine evaluates protocol, exact host, normalized port, decoded path, method, stop-state, and rate-budget rules. Exclusions override path allowances. Redirect candidates are re-evaluated independently. Candidate bodies are not interpreted as permission for destination-like values, DNS is never resolved, and the preview API contains no network client or redirect follower.

## Learning Boundary

The curriculum is a static manifest in `packages/web/src/lessons`. Recommendations map observed methods, input locations, and hypothesis signals to lessons without an LLM. The classroom is not an LMS and does not infer that a vulnerability exists.

## Future Boundaries

Active controlled request execution, a full pan/zoom graph canvas, remaining lesson prose, and evidence export remain planned work. P8 supplies only the prerequisite decision boundary; active replay remains disabled pending separate review.
