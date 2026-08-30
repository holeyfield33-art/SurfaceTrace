# SurfaceTrace Course and Run Manual

## 0. How to Use This Document

This document is both the operating manual and the beginner course for SurfaceTrace. If you only need to run the application, follow the numbered actions in Chapters 3 and 4. If you are learning web-application review, read the explanation, example, pitfall, and checkpoint material as well. The chapters use the same order as the product so that learning never becomes detached from the buttons and records you see.

Allow about 20 minutes for installation, 45 to 60 minutes for the first passive lab, and 60 to 90 minutes for the full method and safety chapters. Active replay should wait until you have a controlled local service or another target you are explicitly authorized to test.

You need Node.js 22, npm, a modern browser, and a terminal. Docker is optional. Most importantly, you need permission. Authorization means the system owner has allowed you to test a named system under stated limits. A public URL is not permission. SurfaceTrace can enforce a scope you configure, but it cannot decide whether your authorization is legally valid.

> Safety rule: use the bundled fixture or a system you own until you can explain your permission, target host, allowed paths, methods, rate, and stop conditions in one sentence.

### Run Path

1. Install dependencies.
2. Start the API and web UI.
3. Check API health.
4. Import `fixtures/sample.har`.
5. Complete the guided passive comparison.
6. Stop both development processes when finished.

### Learn Path

Follow the run path, but pause at each checkpoint. Explain what you observed in your own words before selecting the next action. SurfaceTrace is designed as a map plus laboratory notebook, not a robot hacker: it helps you organize observations and make one controlled change, but you remain responsible for authorization, interpretation, and conclusions.

## 1. What SurfaceTrace Is and Is Not

Imagine walking through a building with permission to inspect its doors. A scanner tries many doors quickly. SurfaceTrace instead gives you a map of the doors you already observed and a notebook for recording what happened when you changed one thing. In web terms, the doors are endpoints, the map is the attack-surface graph, and the notebook contains observations, hypotheses, experiments, diffs, conclusions, and hash-linked evidence.

SurfaceTrace imports authorized HTTP traffic from a HAR file, removes recognized secrets, groups similar URLs into endpoints, identifies input locations, and generates defensive review questions. It supports passive comparison of imported observations and human-approved active replay of one reconstructed request. Every active request requires configured scope, an exact redacted preview, and a separate approval.

A scanner automatically sends many probes. SurfaceTrace has no crawler, spray, bulk replay, fuzzing engine, or autonomous exploitation. Burp Suite and Caido are interception proxies used to capture and manually alter traffic; SurfaceTrace complements them by organizing investigation context and evidence rather than replacing them. OWASP Threat Dragon is primarily a diagram-centered threat-modeling tool; SurfaceTrace begins with observed HTTP transactions and connects them to controlled experiments. Browser developer tools show what your browser sent and received; they are a practical source for the HAR that SurfaceTrace studies.

The discipline SurfaceTrace enforces is **one variable at a time**. If a baseline requests project 100 and a comparison requests project 200, the declared change is the path identifier. If you also change identity, method, and a header, you can no longer tell which change caused a response difference. The server rejects zero mutation categories and multiple mutation categories.

Evidence in SurfaceTrace is not a claim that an AI found a vulnerability. Evidence is a sequence of redacted records linked by content hashes. A content hash is a deterministic fingerprint of data. If an earlier record changes, ledger verification fails. This supports reproducibility: another reviewer can see which observation, mutation, approval, response, diff, and conclusion belong together.

### How This Course Maps to the Product

The audit for this manual covered all repository Markdown, the React UI strings, every Fastify route, exported core behavior, package scripts, and all four entries in `fixtures/sample.har`.

The current UI supports HAR import, inventory counts, endpoint focus, raw redacted HTTP inspection, parsed inputs, identity assignment, graph context, manual asset and trust-boundary annotations, generated threat cards, passive identity comparison, an experiment notebook, runtime scope configuration and no-network preview, and a bounded active-replay panel. The Evidence view displays hash-linked records. The Classroom contains short contextual lessons, but this manual is the authoritative beginner sequence.

The API additionally exposes project creation/opening, import history, direct inventory/graph/endpoints/hypotheses/evidence retrieval, runtime replay credential registration, and record update routes. Those API-only operations are documented in the appendix.

The product does not capture browser traffic itself. It does not provide a proxy, scanner, crawler, payload library, exploit generator, bulk mode, automatic redirect following, automatic retries, automatic vulnerability verdicts, or cloud collection of raw sessions. The graph is an investigation view, not a full free-form threat-diagram editor. The bundled `lab.example.com` HAR is synthetic and non-routable; it is suitable for passive learning, not live replay.

The main education gaps found by the audit were unexplained jargon, no complete first-session path, no entry-by-entry fixture explanation, and no single place that connected passive comparison to the newer active-replay safety model. The chapters below close those documentation gaps without adding product behavior.

## 2. Concepts to Understand Before Clicking

### Authorized Target and Scope

**Example first:** permission might say, "Test `staging.example.test`, only paths under `/api/projects`, using GET and POST, at no more than five requests per minute." The named system and limits form the authorized target and scope.

Scope matters because a technically possible request may still be prohibited. SurfaceTrace stores allowed protocols, hosts, ports, path prefixes, methods, rate, exclusions, and stop conditions. Missing or invalid scope fails closed, meaning no active request is sent.

A common mistake is assuming a bug-bounty program authorizes every company host or every technique. Read the program rules and record narrower limits when uncertain.

### HTTP Request and Response

An HTTP request is a message from a client to a server. It contains a method, target path, headers, and sometimes a body. A response is the server's answer, containing a status, headers, and often a body.

In the fixture, `GET /api/projects/100` is a request. The `200 OK` JSON describing project Alpha is its response. They matter as a pair: a request change is interpreted through the response change.

A common mistake is reading only the response body and forgetting which exact method, identity context, and input produced it.

### Method, Path, Query, Headers, Body, and Cookies

Consider:

```http
POST /api/projects?preview=true HTTP/1.1
Content-Type: application/json
Cookie: session=[REDACTED]

{"name":"Gamma"}
```

The **method** is `POST`, the action style requested. The **path** is `/api/projects`, the resource location. The **query** is the text after `?`, here `preview=true`. **Headers** are metadata such as content type. The **body** carries content such as JSON. A **cookie** is state the client returns to a matching server, often to associate a session.

Each location can change server behavior and therefore becomes a possible input dimension. A common mistake is saying "the URL changed" without naming whether the path or query changed.

### Status Codes

A status code is a three-digit summary of the response outcome. At beginner level, `2xx` usually means the server handled the request, `4xx` means the request was rejected or could not be fulfilled, and `5xx` means the server encountered an error. In the fixture, `200` means the project reads succeeded, `201` means a project was represented as created, and `403` means the admin request was forbidden.

A status is not a verdict. A `200` does not prove authorization is correct, and a `403` does not prove every bypass has been ruled out.

### Endpoint and URL Instance

A URL instance is one concrete address, such as `https://lab.example.com/api/projects/100`. An endpoint is the normalized method-plus-route pattern that groups equivalent instances, such as `GET /api/projects/{id}`.

This grouping matters because project 100 and project 200 are two observations of one endpoint. A common mistake is counting every object ID as a completely separate endpoint, which hides the repeated application behavior.

### Path Template and Parameterization

SurfaceTrace converts variable-looking path segments into placeholders. The fixture paths `/api/projects/100` and `/api/projects/200` become `/api/projects/{id}`. This process is parameterization.

The template makes the changing input visible and supports one-variable comparison. A common mistake is treating `{id}` as literal text that was sent; it is a normalized description, not the original request target.

### Input

An input is a location where request data enters application behavior. SurfaceTrace records names, locations, inferred types, sensitivity, and counts without using raw secret values as descriptors.

The fixture produces endpoint-scoped descriptors including path `id`, header `Authorization`, cookie `session`, JSON fields `name` and `password`, and query `token`. A common mistake is equating "input" with an HTML form field. Paths, queries, headers, cookies, and request bodies all carry inputs.

### Session, Identity, and Role

A session is server-associated state that helps connect requests over time, often represented by a cookie. An identity is the account context assigned to an observation. A role summarizes expected authority, such as anonymous, user, admin, service, or unknown.

SurfaceTrace includes explicit identities such as Anonymous, Account A, Account B, Privileged/Admin, and Custom. Assignments are manual because a redacted request cannot safely prove who sent it. A common mistake is inferring that any request with a cookie is a particular user or that an "admin" label proves admin privileges.

### Attack Surface

An attack surface is the set of reachable behaviors and data-entry points that deserve review. In SurfaceTrace, observed endpoints and inputs are the grounded center of that surface.

The fixture's surface includes project reads, project creation, and an admin users route. The term does not mean these routes are vulnerable. A common mistake is treating an inventory list as a findings list.

### Trust Boundary

A trust boundary is a place where data or authority crosses between contexts with different expectations. Browser-to-API, user-to-privileged operation, application-to-third-party, and application-to-internal-service are examples.

For the fixture, you might manually annotate "Browser to Projects API" because request data moves from a user-controlled browser into server logic. A common mistake is drawing a boundary around every component without explaining what trust changes across it.

### Asset and Sensitive Data

An asset is something worth protecting: account data, documents, payment data, credentials, administrative functions, or internal service data. The fixture responses include owner email fields, which can be annotated as account data.

The purpose is to prioritize careful review, not to teach data theft. A common mistake is labeling the whole application "sensitive" without linking a concrete asset to relevant endpoints or observations.

### Hypothesis

A hypothesis is a defensive review question grounded in an observed signal. The fixture generates, among others, "Does the server enforce ownership and role authorization for objects accessed via GET /api/projects/{id}?"

A hypothesis guides the next comparison; it is not a confirmed vulnerability. Priority means review urgency based on the signal, not exploit proof. A common mistake is rewriting a question as "IDOR found" before controlled evidence exists.

### Baseline

A baseline is the known observation used as the reference. For a project-object comparison, the imported project 100 transaction can be the baseline.

A baseline matters because "different" only has meaning relative to a known reference. A common mistake is choosing a baseline without checking its exact request, response, and identity assignment.

### Experiment

An experiment pairs a baseline with one declared mutation and a comparison result. A passive experiment compares two imported observations. Active replay reconstructs one baseline request, applies one mutation, shows a preview, and sends only after approval.

A common mistake is changing several dimensions or writing an expected conclusion after seeing the result rather than recording the question first.

### Diff

A diff is a deterministic description of what changed between two responses. SurfaceTrace compares status, selected headers, body structure, nested fields, arrays, types, and bounded truncation state.

For project 100 versus 200, fields such as `id`, `name`, and `ownerEmail` differ. That difference is evidence to interpret, not proof that access should or should not have been allowed. A common mistake is treating any difference as a security issue.

### Evidence Ledger and Content Hash

The evidence ledger is an ordered collection of records in which each record refers to the previous hash. A content hash is the fingerprint calculated from canonical record data.

This structure makes silent editing detectable and preserves investigation sequence across restart. It does not prove the real-world truth of a tester's conclusion; it proves whether the recorded chain remains internally consistent. A common mistake is placing secrets in notes because they are "evidence." Notes are redacted, and sensitive values should not be copied into them.

### HAR File

HAR means HTTP Archive. It is JSON exported by a browser or proxy that records HTTP transactions. In Chromium-based browsers, open Developer Tools, select Network, reproduce only authorized actions, then use the network panel's HAR export. Proxy products have their own export actions.

HAR files can contain session cookies, authorization headers, query tokens, and personal data. Treat the original as sensitive, minimize capture, store it safely, and delete it according to your authorization rules. SurfaceTrace redacts recognized secrets during import, but redaction is not a reason to handle originals carelessly. A common mistake is committing a real HAR to Git.

### Redaction

Redaction replaces recognized sensitive values with `[REDACTED]` before normalized persistence or evidence. SurfaceTrace handles sensitive headers, cookie values, secret-like query names, and secret-like body keys.

The fixture intentionally contains fake bearer, cookie, query-token, and password values so tests can prove they do not survive into canonical records. A common mistake is assuming any redaction system recognizes every business-specific secret. Review normalized output and never use production secrets in a learning lab.

## 3. Install and Start

### Step 1: Obtain the Repository

If you do not already have the repository:

```bash
git clone https://github.com/holeyfield33-art/SurfaceTrace.git
cd SurfaceTrace
```

**Success:** `package.json`, `packages/`, `docs/`, and `fixtures/sample.har` exist.
**Failure:** "repository not found" usually means the URL or access is wrong.
**Why:** npm workspaces must be run from the repository root.

### Step 2: Select Node and Install Dependencies

The repository specifies Node 22 in `.nvmrc`.

```bash
npm install
```

**Success:** npm completes without an error and creates or updates local dependency installation state.
**Failure:** native-module errors commonly mean the wrong Node version or missing build tools. Check `node --version` first.
**Why:** the server, web app, compiler, and test runners are workspace dependencies.

### Step 3: Verify Before Running

```bash
npm test
npm run typecheck
npm run build
```

**Success:** 149 tests pass, typechecking exits successfully, and Vite reports a completed production build.
**Failure:** stop and read the first failing workspace rather than the final npm summary.
**Why:** a clean baseline separates installation problems from later investigation behavior.

### Step 4: Start the API

In terminal one:

```bash
npm run dev
```

**Success:** the log includes `SurfaceTrace server listening on http://127.0.0.1:8787`.
**Failure:** `EADDRINUSE` means port 8787 is already occupied. Stop the existing process or identify it before continuing.
**Why:** Fastify owns import, redaction, persistence, scope, replay, diff, and evidence behavior.

### Step 5: Start the Web UI

In terminal two:

```bash
npm run dev:web
```

**Success:** Vite prints a local URL, normally `http://localhost:5173`.
**Failure:** if port 5173 is occupied, stop the old UI process. Do not silently use a different port unless you also understand CORS and proxy configuration.
**Why:** the React UI calls the API through Vite's `/api` proxy.

### Step 6: Health Check

Open `http://127.0.0.1:8787/health` or run:

```bash
curl http://127.0.0.1:8787/health
```

**Success:** JSON includes `"ok":true`, `"service":"surfacetrace-server"`, `"ledgerValid":true`, and a schema version.
**Failure:** connection refused means the API process is not listening.
**Why:** this distinguishes server readiness from a browser rendering issue.

Then open `http://localhost:5173`. The expected starting navigation includes **COMMAND CENTER**, **INVESTIGATION**, **CLASSROOM**, and **EVIDENCE**.

### Docker Alternative

The Compose service is a development container that starts idle:

```bash
docker compose up -d --build
docker compose ps
docker compose exec surfacetrace npm install
docker compose exec surfacetrace npm test
```

Start API and UI in separate terminals with:

```bash
docker compose exec surfacetrace npm run dev
docker compose exec surfacetrace npm run dev:web
```

If Docker cannot connect to its engine, start Docker Desktop first. Ports 8787 and 5173 are published by `docker-compose.yml`.

## 4. First Successful Session with `fixtures/sample.har`

This lab is passive. The fixture uses `lab.example.com`, a reserved example domain rather than a running lab service. Do not configure it for active replay and expect a response.

### Lab Step 1: State the Authorization Model

**Goal:** begin with explicit boundaries.
**Action:** say, "I am using only the bundled synthetic HAR and will not send network requests."
**Expected result:** you can distinguish imported evidence from active execution.
**Explanation:** learning the interface does not require contacting any target.
**Checkpoint:** explain why a public host would still require permission.

### Lab Step 2: Start and Check the App

**Goal:** establish a known-good runtime.
**Action:** follow Chapter 3 and open the health endpoint and UI.
**Expected result:** health reports `ok: true`; the UI opens on Command Center.
**Explanation:** testing from a broken runtime creates misleading symptoms.
**Checkpoint:** identify which port belongs to Fastify and which belongs to Vite.

### Lab Step 3: Import the Fixture in the UI

**Goal:** create a redacted investigation inventory.
**Action:** in Command Center, choose the HAR import control and select `fixtures/sample.har`.
**Expected result:** the attack-surface metrics show 3 endpoints, 8 input descriptors, 4 observations, and 3 hypotheses.
**Explanation:** four URL instances normalize into three method/path endpoint groups.
**Checkpoint:** explain why two project URLs count as one endpoint.

API alternative:

```bash
node -e "const fs=require('fs'); fetch('http://127.0.0.1:8787/import/har',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({har:fs.readFileSync('fixtures/sample.har','utf8'),sourceLabel:'beginner fixture'})}).then(async r=>console.log(r.status,await r.text()))"
```

A successful response reports the same counts. Importing through either UI or API persists the canonical investigation in SQLite.

### Lab Step 4: Read the Inventory

**Goal:** understand counts as observations, not findings.
**Action:** read the Command Center metrics and investigation queue.
**Expected result:** you see observed endpoints and generated hypotheses labeled as questions, not findings.
**Explanation:** inventory measures captured structure. It does not measure vulnerability count.
**Checkpoint:** state what the number 3 means for endpoints and hypotheses separately.

### Lab Step 5: Inspect the Project Endpoint

**Goal:** connect normalized structure to raw HTTP.
**Action:** open **INVESTIGATION**, select `GET /api/projects/{id}`, and inspect REQUEST, RESPONSE, PARSED, and DIFF tabs.
**Expected result:** two observations are available; credential material is shown as `[REDACTED]`; parsed input includes `path.id`. DIFF initially says no comparison is recorded.
**Explanation:** the inspector preserves useful protocol structure while removing recognized secrets.
**Checkpoint:** locate method, original target, response status, and the path input.

### Lab Step 6: Explain All Four Fixture Entries

**Goal:** understand why each synthetic transaction exists.
**Action:** compare the inspector with the appendix fixture walkthrough.
**Expected result:** you can identify two object reads, one state-changing creation, and one denied admin read.
**Explanation:** these entries trigger three different review questions: object authorization, state-change protections, and privileged-route restriction.
**Checkpoint:** explain why `403` is an observation rather than proof of complete security.

### Lab Step 7: Form a Hypothesis

**Goal:** convert a signal into a narrow question.
**Action:** choose the object-authorization threat card. In your own words, write: "When only the project ID changes, does the server return data appropriate for the same authorized identity?"
**Expected result:** the question refers to one endpoint, one input, and an expected policy without declaring a finding.
**Explanation:** good hypotheses are answerable by controlled evidence.
**Checkpoint:** remove any words such as "definitely vulnerable" from your question.

### Lab Step 8: Assign Identity Context

**Goal:** avoid comparing ambiguous account contexts.
**Action:** in the HTTP inspector, assign both imported project observations to Account A for this synthetic exercise.
**Expected result:** identity labels persist and appear in comparison context.
**Explanation:** the fixture contains fake redacted credentials and cannot prove identity, so the tester supplies context manually.
**Checkpoint:** explain why SurfaceTrace does not infer Account A from a cookie.

### Lab Step 9: Perform a Passive One-Variable Experiment

**Goal:** compare imported evidence without network execution.
**Action:** in **CONTROLLED COMPARISON**, choose the object-authorization hypothesis, lock project 100 as baseline, select path input `id`, enter baseline `100` and changed value `200`, choose project 200 as the result observation, add an expectation note, and select **COMPARE + SAVE EVIDENCE**.
**Expected result:** SurfaceTrace accepts one path mutation, creates a deterministic diff, and saves experiment and diff evidence.
**Explanation:** only the project identifier changed in the declared comparison. No request is sent.
**Checkpoint:** name the one mutation category and confirm the result came from the imported HAR.

### Lab Step 10: Interpret and Conclude

**Goal:** separate mechanical difference from human judgment.
**Action:** review status, headers, and body-field changes. In the Experiment Notebook, choose a conclusion such as `needs_more_testing` unless your authorization and account policy justify something stronger. Save notes and status.
**Expected result:** the notebook links baseline, changed variable, comparison, diff, conclusion, and evidence IDs.
**Explanation:** two different project bodies are expected when IDs differ. The security question is whether the observed identity should have received each body, which the fixture alone cannot establish.
**Checkpoint:** explain why "different" is not synonymous with "vulnerable."

### Lab Step 11: Verify Evidence

**Goal:** finish with a reproducible record.
**Action:** open **EVIDENCE** and review the hash-linked records. Refresh or restart the server and reload the saved investigation if desired.
**Expected result:** evidence remains available and the health endpoint reports `ledgerValid: true`.
**Explanation:** SQLite restores canonical records; hash links detect record-chain mutation.
**Checkpoint:** distinguish ledger integrity from correctness of your conclusion.

## 5. The Full Method

### Stage 1: Identify the Authorized Target

Purpose: turn permission into operational limits before collecting or sending traffic.

In the tool, configure Runtime Scope Gate only when active replay is intended. With your brain, ask who owns the system, which environment is allowed, which accounts are approved, and what could cause impact. A worked example is a local lab on `127.0.0.1:3000`, paths under `/api/`, GET only, five requests per minute. The pitfall is broadening scope because another hostname looks related.

Checkpoint answer: if scope is missing, SurfaceTrace must send zero requests.

### Stage 2: Capture and Import

Purpose: ground the investigation in traffic you actually observed.

Use browser DevTools or an interception proxy to capture the smallest useful authorized session, export HAR, and import it. SurfaceTrace accepts bounded HTTP/HTTPS entries, tolerates malformed entries by skipping them, and redacts before canonical storage. Ask whether the capture contains the identity states and actions needed for your question. The pitfall is importing a huge browsing session full of unrelated noise and sensitive data.

Checkpoint answer: the original HAR remains sensitive even after SurfaceTrace creates a redacted inventory.

### Stage 3: Inventory and Inspect

Purpose: learn what methods, route patterns, statuses, and input locations are present.

Use Command Center metrics, endpoint graph nodes, HTTP Inspector, and parsed inputs. Ask which endpoints handle objects, state changes, privileged functions, redirects, or destination-like values. The worked fixture groups project IDs under one endpoint. The pitfall is treating generated counts as a vulnerability report.

Checkpoint answer: an endpoint is a normalized behavior pattern; an observation is one captured transaction.

### Stage 4: Map Identity, Assets, and Boundaries

Purpose: add the human context HTTP alone cannot prove.

Assign observations to explicit identities. Add an asset only when you can name what must be protected, and add a boundary only when you can explain the change in trust. For owner email data, an account-data asset linked to the project endpoint is clearer than "sensitive app." The pitfall is creating decorative labels without links or rationale.

Checkpoint answer: identity assignments are assertions made by the tester, not credential-derived facts.

### Stage 5: Choose a Hypothesis

Purpose: select one review question that can be investigated with available evidence.

Use Threat Cards and their signal, priority, linked inputs, and reasoning. Ask what policy should hold and what observation would challenge it. A priority 8 admin-route question should be reviewed urgently, but priority is not proof. The pitfall is following every generated question at once.

Checkpoint answer: choose the thread with the clearest authorization, baseline, and expected policy.

### Stage 6: Lock a Baseline and One Variable

Purpose: preserve causal clarity.

Inspect the exact baseline request and response, choose one mutation category, and record the expected outcome. Allowed categories are path parameter, query parameter, header, body field, or identity. The pitfall is hiding additional request changes behind vague notes.

Checkpoint answer: zero or multiple mutation categories are rejected.

### Stage 7A: Compare Imported Observations

Purpose: learn from already captured traffic without network activity.

Choose a matching imported result and let the server validate endpoint, hypothesis, input, and request relationships. Review the deterministic diff. The pitfall is pairing observations from unrelated endpoints because their bodies look similar.

Checkpoint answer: passive comparison consumes no active scope or rate budget.

### Stage 7B: Perform Human-Approved Active Replay

Purpose: make one bounded request when imported evidence is insufficient and authorization permits it.

Use a controlled live baseline, not the synthetic example domain. Configure exact scope, select one observed input mutation in the replay panel, and prepare. The core/API also supports explicit identity mutation with separately registered runtime credentials, but that identity control is API-only in the current UI. Preparation shows a redacted baseline, changed-only description, candidate request, scope result, and rate status without sending. Read every line, then select **SEND THIS REQUEST** once.

The server rechecks protocol, host, port, normalized path, method, stop conditions, and rate immediately before execution. It sends through one dedicated HTTP client with a bounded timeout and response size, no retry, and redirect mode set to manual. A redirect is displayed as a proposal and requires a new approval.

The pitfall is treating preview as a formality. If the method, target, identity, or changed value is surprising, cancel.

Checkpoint answer: one preview token and one approval can produce at most one request.

### Stage 8: Interpret, Continue, or Stop

Purpose: decide what the evidence means without outrunning it.

Read status, headers, nested fields, array changes, types, and truncation. Choose `same`, `different`, or `needs review` as mechanical/investigation states, then record a human conclusion. A difference may create a narrower follow-up hypothesis, but SurfaceTrace will not send it automatically. The pitfall is escalating from one odd response to broad probing.

Checkpoint answer: uncertainty is a valid reason to stop and request clarification.

### Stage 9: Preserve Evidence and Finish

Purpose: leave a reviewable record and stop runtime activity cleanly.

Save notes and conclusion without secrets, verify the evidence ledger, and record external authorization references outside sensitive payloads. Stop the UI and API with Ctrl+C in their terminals. Runtime identity credentials disappear with the process; canonical investigation state remains in SQLite.

Checkpoint answer: a clean finish includes stopped processes, protected source HARs, and a human-readable conclusion.

## 6. Reading the Graph and Threat Signals

Graph nodes represent entities in the investigation. Endpoint and input nodes come from observed traffic. Identity, observation, asset, trust-boundary, hypothesis, and experiment nodes add context with provenance labels such as observed, manual, or inferred. Edges explain relationships such as an endpoint accepting an input or a hypothesis questioning an endpoint.

Read from grounded nodes outward. Start with an endpoint you recognize, inspect its inputs and observations, then follow one hypothesis edge. Manual asset or boundary nodes show tester-supplied context. An inferred node means deterministic code recognized a pattern; it does not mean the application is vulnerable.

Priority is review urgency. In the fixture, the admin route receives priority 8 because privileged-looking paths deserve careful authorization review. The object-ID route receives priority 7 because object references often cross ownership decisions. The POST receives priority 6 because state changes deserve session, origin, and authorization review. None of these numbers is exploit likelihood.

To reduce noise, pick a thread for which you have a clear baseline, identity context, and policy question. Mark other questions for later rather than blending them into one experiment.

## 7. One-Variable Discipline

Suppose you change project ID, remove the cookie, switch GET to POST, and add a header. The response changes from 200 to 403. Which change mattered? You cannot know. A controlled experiment changes one category so the result can update one hypothesis.

SurfaceTrace enforces five mutation categories:

1. **Path parameter:** `/projects/100` to `/projects/200`.
2. **Query parameter:** `?view=summary` to `?view=full`.
3. **Header:** one named header value changes.
4. **Body field:** one named JSON/body path changes.
5. **Identity:** one explicit role/identity context changes, with target runtime credentials required for active replay.

A useful experiment card in prose is:

```text
Question: Does Account A receive only projects it is allowed to view?
Baseline: Account A, GET /api/projects/100, imported response 200.
Changed only: path.id from 100 to 200.
Expected: response follows the documented ownership policy.
Result: imported response 200 with a different project body.
Interpretation: different object data; authorization meaning needs account-policy evidence.
Next question: Was project 200 assigned to Account A in this authorized lab?
```

`same` means no material difference was recorded under the implemented diff. `different` means one or more compared properties changed. `needs review` is the honest state when the mechanical output is insufficient or context is uncertain. Turn a difference into a narrower question, not an accusation.

## 8. Ethics, Scope, and Stop Conditions

Only test systems for which you have explicit authorization. Out of scope can mean the wrong hostname, environment, account, path, method, time window, data class, or technique. If permission is unclear, do not send.

Stop immediately if you encounter real user data you were not meant to access, production instability, repeated server errors, lost authentication, unexpected destructive behavior, or uncertainty about permission. SurfaceTrace supports manual stop, maximum request count, repeated-server-error, authentication-lost, custom-note, and rolling rate controls. These controls reduce mistakes but cannot understand contracts, business impact, or intent.

The tool fails closed when active scope is absent or a gate rejects the candidate. It consumes rate budget only immediately before sending. It does not automatically clear stop conditions, retry failures, follow redirects, iterate IDs, change accounts, or probe related hosts.

You remain responsible for protecting HAR originals, avoiding secrets in notes, interpreting results, and reporting through the authorized channel.

## 9. Glossary

**Active replay:** A single reconstructed request sent only after scope checks, an exact preview, and explicit human approval. See Chapter 5, Stage 7B.

**Asset:** Data or functionality worth protecting, linked manually to investigation context.

**Attack surface:** The observed endpoints and inputs that deserve structured review.

**Authorization:** Permission from a system owner and, within an application, the policy deciding what an identity may do.

**Baseline:** The known observation used as the reference for an experiment.

**Body:** Request or response content carried after headers, often JSON or form data.

**Content hash:** A deterministic fingerprint used to detect changes in canonical evidence.

**Cookie:** Client-returned state metadata, often associated with a session.

**Diff:** A deterministic account of response changes between baseline and result.

**Endpoint:** A normalized method and route pattern that groups URL instances.

**Evidence ledger:** Ordered, hash-linked redacted records describing investigation activity.

**Experiment:** A baseline, one declared mutation, a comparison result, a diff, and a human conclusion.

**HAR:** HTTP Archive JSON exported by a browser or proxy; the original may contain secrets.

**Header:** HTTP metadata such as content type or authorization context.

**Hypothesis:** A defensive review question inferred or maintained for investigation, not a finding.

**Identity:** Explicit account context assigned by a tester to observations.

**Input:** A path, query, header, cookie, or body field that enters application behavior.

**Method:** The HTTP action token, such as GET, POST, PUT, PATCH, or DELETE.

**Observation:** One canonical redacted imported or replayed HTTP transaction.

**Path:** The route portion of a URL before the query string.

**Path template:** A normalized route where variable-looking segments become placeholders.

**Query:** Named URL data after the `?` character.

**Redaction:** Replacement of recognized sensitive values before canonical storage or evidence.

**Response status:** A three-digit summary of server handling, not a security verdict.

**Role:** A conceptual authority grouping such as anonymous, user, admin, or service.

**Scope:** Explicit active-execution limits for protocol, host, port, path, method, rate, and stop state.

**Session:** Server-associated continuity across requests, often represented by a cookie.

**Trust boundary:** A crossing between contexts with different trust or authority assumptions.

**URL instance:** One concrete URL, as opposed to a normalized endpoint pattern.

## 10. Appendix

### Command Cheat Sheet

```bash
# Install and verify
npm install
npm test
npm run typecheck
npm run build

# Run in two terminals
npm run dev
npm run dev:web

# Health
curl http://127.0.0.1:8787/health

# Docker development environment
docker compose up -d --build
docker compose ps
docker compose exec surfacetrace npm install
docker compose exec surfacetrace npm test
docker compose exec surfacetrace npm run typecheck
docker compose exec surfacetrace npm run build

# Stop local npm development processes
# Press Ctrl+C in each terminal

# Stop Docker services
docker compose down
```

### API Route Table

The web development server proxies `/api/*` to these Fastify routes without the `/api` prefix.

| Method | Route | Current purpose |
| --- | --- | --- |
| GET | `/health` | Service, ledger, and schema health |
| GET | `/projects` | List projects and active project |
| POST | `/projects` | Create a project |
| POST | `/projects/:projectId/open` | Restore a saved project |
| GET | `/projects/:projectId/imports` | List project imports |
| POST | `/import/har` | Import a HAR string |
| GET | `/graph` | Read the current graph |
| GET | `/endpoints` | Read normalized endpoints |
| GET | `/hypotheses` | Read generated/maintained hypotheses |
| GET | `/evidence` | Read and verify the evidence ledger |
| GET | `/scope` | Read active scope |
| PUT | `/scope` | Configure scope |
| POST | `/scope/preview` | Evaluate a candidate without network activity |
| POST | `/scope/redirect-preview` | Evaluate a redirect target without following it |
| POST | `/scope/budget/consume` | Explicitly consume one configured budget unit |
| PUT | `/replay/credentials/:identityId` | Register runtime-only identity material |
| POST | `/replay/prepare` | Reconstruct and preview one candidate |
| POST | `/replay/:token/cancel` | Cancel a prepared candidate |
| POST | `/replay/:token/send` | Approve and send one prepared request |
| GET | `/inventory` | Read complete current investigation state |
| PATCH | `/observations/:observationId/identity` | Assign an explicit identity |
| POST | `/assets` | Create a manual asset annotation |
| PATCH | `/assets/:assetId` | Update an asset |
| DELETE | `/assets/:assetId` | Delete an asset |
| POST | `/trust-boundaries` | Create a manual boundary |
| PATCH | `/trust-boundaries/:boundaryId` | Update a boundary |
| DELETE | `/trust-boundaries/:boundaryId` | Delete a boundary |
| PATCH | `/hypotheses/:hypothesisId` | Update hypothesis status, notes, and links |
| GET | `/experiments` | List/filter experiments |
| GET | `/experiments/:experimentId` | Read one experiment |
| PATCH | `/experiments/:experimentId` | Update status, conclusion, or notes |
| POST | `/experiments` | Create a passive imported-observation comparison |

Use the UI for the normal beginner workflow. The route table is for troubleshooting and integration reference, not encouragement to bypass safety controls.

### Fixture Walkthrough

**Entry 1: GET project 100.** The request contains fake Authorization and session-cookie values that must redact. The 200 response contains project Alpha and an owner email. This entry supplies the first observation for `GET /api/projects/{id}`.

**Entry 2: GET project 200.** The method and route pattern match Entry 1, while the path ID and response fields differ. This supplies the passive comparison result. The fixture does not establish who should access either project.

**Entry 3: POST projects.** The JSON body contains `name` and a fake `password` field. The password must redact. The 201 response represents creation. This triggers a state-changing-method review question about session, origin, and authorization protections.

**Entry 4: GET admin users.** The query includes a fake secret-like `token`, which must redact. The response is 403 Forbidden. The admin-looking path triggers a privileged-route review question. The denial is one observation, not proof that all unauthorized paths are impossible.

After normalization, the fixture has 4 observations, 3 endpoints, 8 endpoint-scoped input descriptors, and 3 generated hypotheses.

### If You Get Stuck

```text
Does /health connect?
|-- No -> Is npm run dev still running? Is port 8787 free?
|-- Yes
    |
    Does the UI open on :5173?
    |-- No -> Is npm run dev:web running? Is port 5173 free?
    |-- Yes
        |
        Does import fail?
        |-- Invalid HAR -> Confirm you selected fixtures/sample.har unchanged.
        |-- Too large -> Check configured HAR byte/entry limits.
        |-- No inventory -> Read the API terminal and browser console.
        |
        Does active preview deny?
        |-- No active scope -> Configure exact authorized scope.
        |-- Host/port/path/method denied -> Do not broaden blindly; compare authorization.
        |-- Stop/rate denied -> Stop and resolve the configured safety condition.
        |
        Did send fail?
        |-- Timeout -> Confirm the authorized controlled service is reachable.
        |-- Redirect -> Expected: redirects are not followed.
        |-- Credential unavailable -> Register explicit runtime identity material or remain passive.
```

If the issue remains, preserve the exact error text, route, and safe reproduction steps. Never paste real session values into an issue.

### Not in This Version

The current version intentionally does not include a traffic-capture proxy, crawler, scanner, bulk replay, fuzzing engine, payload library, automatic ID iteration, automatic redirect following, retries, automatic attack generation, autonomous exploitation, AI vulnerability verdicts, internet-wide scanning, or cloud collection of raw sessions.

A full free-form threat-diagram editor and automatic proxy integration are also not present. Use browser DevTools, Burp Suite, or Caido for authorized capture and manual proxy work, then use SurfaceTrace for structured investigation and evidence.

