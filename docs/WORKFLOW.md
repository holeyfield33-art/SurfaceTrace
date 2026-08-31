# SurfaceTrace Tester Workflow

This is the canonical workflow for authorized SurfaceTrace investigations. SurfaceTrace organizes tester decisions and evidence; it does not determine that a vulnerability exists.

## Passive Investigation

```text
authorize
-> capture
-> import
-> inspect redacted HTTP
-> map endpoints, inputs, identities, assets, and trust boundaries
-> form grounded hypotheses
```

1. Confirm written authorization and target boundaries outside SurfaceTrace.
2. Capture relevant traffic with browser developer tools, Burp Suite, Caido, or another authorized capture tool.
3. Export and import a bounded HAR.
4. Inspect canonical redacted request and response data.
5. Review parsed endpoints and inputs, then add explicit identity, asset, and trust-boundary context.
6. Treat generated hypotheses as review questions, never findings.

Passive investigation sends no requests.

Before starting either UI or API, verify the intended listeners and host firewall. The supported default is `127.0.0.1`; non-loopback UI exposure, port forwarding to untrusted clients, and shared-network deployment are unsupported. Proxy forwarding headers are not authentication evidence, and token authentication remains required for protected routes whenever `SURFACETRACE_API_TOKEN` is configured.

## Controlled Comparison

```text
known baseline
-> exactly one declared mutation
-> corresponding imported observation
-> deterministic deep diff
-> human conclusion
-> hash-linked evidence
```

Choose two imported observations from the same endpoint and declare the single request difference that connects them. The server rejects zero mutations, multiple mutation categories, unrelated observations, and undeclared request differences. The deterministic diff reports status, headers, nested body and array changes, type changes, and truncation without producing a vulnerability verdict.

## Active Replay

```text
known baseline
-> exactly one mutation
-> reconstructed candidate request
-> scope check
-> rate check
-> stop check
-> exact redacted preview
-> explicit human approval
-> one outbound request
-> redacted response capture
-> deterministic deep diff
-> human conclusion and evidence
```

1. Configure an active project scope. Missing or invalid scope fails closed.
2. Select a known imported baseline and one observed input mutation in the replay panel. Explicit identity mutation is supported through the API, not the current panel.
3. Prepare the replay. Preparation performs no network activity and consumes no rate budget.
4. Review the exact redacted outbound request, changed-only description, scope decision, and rate availability.
5. Select `SEND THIS REQUEST` to approve one request.
6. SurfaceTrace rechecks scope, rate, and stop conditions immediately before sending.
7. Review the redacted response and deterministic diff in the existing experiment notebook.
8. Record the tester-controlled conclusion and preserve the linked evidence.

The preview token is single-use. Canceling, invalid mutations, denied scope, exhausted rate, or active stop conditions produce zero outbound requests. SurfaceTrace never retries automatically, follows redirects automatically, or starts another experiment. A redirect is only a proposed target and requires a new approval.

## Controlled Replay Lab

```text
separate localhost lab
-> deterministic synthetic routes
-> one controlled mutation practice
-> preview scope and behavior
-> no production integration
```

Use the standalone `examples/controlled-replay-lab/` application when you want to practice replay reasoning without touching the SurfaceTrace server. It binds to `127.0.0.1` by default, serves synthetic routes only, and refuses non-loopback binding unless you set an explicit unsafe override.

The lab exists to teach the replay boundary:

- baseline object versus controlled comparison object
- redirect behavior without automatic following
- slow responses without retry loops
- bounded large responses with truncation
- the difference between preview, approval, and send in a sandbox

## Identity Testing

### Account A / Account B

1. Capture authorized baseline observations for each account.
2. Assign each observation to the correct explicit identity.
3. Use passive cross-identity comparison to establish request and response differences.
4. For API-driven active identity replay, explicitly register Account B runtime credential material, then prepare an Account A baseline with one identity mutation.
5. Verify the redacted preview identifies the intended transition before approving one request.

SurfaceTrace does not infer, harvest, persist, or automatically swap credentials. If target identity material is unavailable, replay is denied.

### Anonymous / Authenticated

Assign anonymous and authenticated observations explicitly, compare imported behavior first, and form a narrow authorization hypothesis. Any active transition still requires explicitly associated runtime material where credentials are needed, configured scope, exact preview, and one human approval.

Different responses do not by themselves prove an access-control vulnerability. The tester records the conclusion.

## SSRF Reasoning

SurfaceTrace recognizes destination-like input names, absolute-URL value classes, redirect context, and endpoint context. It creates review questions and teaching context without retaining sensitive destination values.

These signals do not establish SSRF. SurfaceTrace does not automatically probe destinations, follow redirects, generate payloads, scan internal hosts, or issue a vulnerability verdict. The tester must interpret application behavior and authorize every replay separately.

## Safety Checklist

1. Authorization first.
2. No valid scope means no execution.
3. Declare exactly one mutation.
4. One explicit approval sends one request.
5. Redirects require new approval.
6. No automatic retries.
7. Rate and stop conditions fail closed.
8. Secrets are redacted before persistence or evidence.
9. Identity assignments are explicit and manual.
10. Hypotheses are not vulnerability verdicts.
11. Conclusions remain human-controlled.
12. No bulk replay, automated exploitation, fuzzing, crawling, or payload spray.

## Tool Roles

- Browser / DevTools: observe application behavior and export traffic.
- Burp Suite / Caido: capture traffic and perform manual HTTP manipulation.
- SurfaceTrace: organize investigation context, threat mapping, controlled replay, deterministic comparison, conclusions, and evidence.

SurfaceTrace is not positioned as a Burp Suite or Caido replacement.

## Three-Agent Security Teams

Use `npm run team:pentest` for boundary-focused verification or `npm run team:redteam` for adversarial assumption review. Both commands create three independent, scoped prompt packets under ignored `security-runs/`; they do not invoke a model or send traffic. Active mode is restricted to an explicit loopback target. After the three receipts are saved, `npm run team:gate -- <run-dir>` applies the deterministic PASS/BLOCK/FREEZE gate described in `security-teams/README.md`.
