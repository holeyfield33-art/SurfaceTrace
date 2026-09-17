# SurfaceTrace starter HARs

These are synthetic HAR 1.2 files for passive learning in SurfaceTrace. Every request uses a reserved `.test` host. The credentials, cookies, identities, and personal-looking values are invented. Do not configure active replay for these hosts.

Import one file at a time because a new import replaces the project’s active import.

| File | What it teaches | Useful first task |
|---|---|---|
| `01-access-control.har` | Anonymous, Account A, and Account B observations over the same object-shaped endpoint | Assign identities and compare the 200, 401, and 403 observations |
| `02-input-surfaces.har` | Path, query, selected header, nested JSON, and array inputs | Inspect the generated endpoint templates and input inventory |
| `03-response-diffs.har` | Status, field, type, nested-object, and array changes | Create a passive one-variable comparison for `format` |
| `04-redaction-practice.har` | Synthetic authorization, cookie, query, request-body, and response-body secrets | Verify which values become `[REDACTED]` after import |

Start SurfaceTrace, open Command Center, select **IMPORT AUTHORIZED HAR**, and choose one of these files. These fixtures are passive evidence only; importing them sends no network traffic.

`generate.mjs` is the deterministic source for the four files. Run `node fixtures/starter-hars/generate.mjs` after intentionally changing the generator.
