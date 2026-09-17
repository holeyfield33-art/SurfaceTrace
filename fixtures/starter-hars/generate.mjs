import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const output = dirname(fileURLToPath(import.meta.url));
mkdirSync(output, { recursive: true });

const header = (name, value) => ({ name, value });
const jsonHeaders = [header("Content-Type", "application/json")];

function entry({ at, method = "GET", url, status = 200, statusText = "OK", requestHeaders = [], queryString = [], cookies = [], requestBody, responseBody = {}, responseHeaders = jsonHeaders, mimeType = "application/json" }) {
  const responseText = typeof responseBody === "string" ? responseBody : JSON.stringify(responseBody);
  const request = { method, url, httpVersion: "HTTP/1.1", headers: requestHeaders, queryString, cookies };
  if (requestBody !== undefined) request.postData = { mimeType: "application/json", text: JSON.stringify(requestBody) };
  return {
    startedDateTime: at,
    time: 20,
    request,
    response: {
      status,
      statusText,
      httpVersion: "HTTP/1.1",
      headers: responseHeaders,
      cookies: [],
      content: { size: Buffer.byteLength(responseText), mimeType, text: responseText },
      redirectURL: "",
    },
    cache: {},
    timings: { send: 1, wait: 18, receive: 1 },
  };
}

function har(entries, purpose) {
  return { log: { version: "1.2", creator: { name: "SurfaceTrace starter fixtures", version: "1.0" }, comment: purpose, entries } };
}

const fixtures = {
  "01-access-control.har": har([
    entry({ at: "2026-09-17T16:00:00.000Z", url: "https://access.training.example.test/api/projects/100", requestHeaders: [header("Accept", "application/json"), header("Authorization", "Bearer TRAINING_ACCOUNT_A")], cookies: [{ name: "session", value: "TRAINING_SESSION_A" }], responseBody: { id: 100, name: "Alpha", owner: "Account A", visibility: "private" } }),
    entry({ at: "2026-09-17T16:00:01.000Z", url: "https://access.training.example.test/api/projects/200", requestHeaders: [header("Accept", "application/json"), header("Authorization", "Bearer TRAINING_ACCOUNT_A")], cookies: [{ name: "session", value: "TRAINING_SESSION_A" }], status: 403, statusText: "Forbidden", responseBody: { error: "project_access_denied", projectId: 200 } }),
    entry({ at: "2026-09-17T16:00:02.000Z", url: "https://access.training.example.test/api/projects/200", requestHeaders: [header("Accept", "application/json"), header("Authorization", "Bearer TRAINING_ACCOUNT_B")], cookies: [{ name: "session", value: "TRAINING_SESSION_B" }], responseBody: { id: 200, name: "Beta", owner: "Account B", visibility: "private" } }),
    entry({ at: "2026-09-17T16:00:03.000Z", url: "https://access.training.example.test/api/projects/100", requestHeaders: [header("Accept", "application/json")], status: 401, statusText: "Unauthorized", responseBody: { error: "authentication_required" } }),
  ], "Identity and object-level authorization comparisons."),

  "02-input-surfaces.har": har([
    entry({ at: "2026-09-17T16:10:00.000Z", url: "https://inputs.training.example.test/api/search?q=alpha&page=1", requestHeaders: [header("Accept", "application/json"), header("X-View", "compact")], queryString: [{ name: "q", value: "alpha" }, { name: "page", value: "1" }], responseBody: { results: [{ id: 100, name: "Alpha" }], page: 1 } }),
    entry({ at: "2026-09-17T16:10:01.000Z", url: "https://inputs.training.example.test/api/search?q=beta&page=1", requestHeaders: [header("Accept", "application/json"), header("X-View", "compact")], queryString: [{ name: "q", value: "beta" }, { name: "page", value: "1" }], responseBody: { results: [{ id: 200, name: "Beta" }], page: 1 } }),
    entry({ at: "2026-09-17T16:10:02.000Z", method: "POST", url: "https://inputs.training.example.test/api/projects", requestHeaders: [header("Content-Type", "application/json")], requestBody: { name: "Gamma", tags: ["training", "demo"], settings: { archived: false } }, status: 201, statusText: "Created", responseBody: { id: 300, name: "Gamma", tags: ["training", "demo"] } }),
    entry({ at: "2026-09-17T16:10:03.000Z", method: "PATCH", url: "https://inputs.training.example.test/api/projects/300", requestHeaders: [header("Content-Type", "application/json"), header("If-Match", "training-v1")], requestBody: { settings: { archived: true } }, responseBody: { id: 300, name: "Gamma", settings: { archived: true } } }),
  ], "Path, query, selected-header, nested JSON, and array inputs."),

  "03-response-diffs.har": har([
    entry({ at: "2026-09-17T16:20:00.000Z", url: "https://diffs.training.example.test/api/reports/weekly?format=summary", queryString: [{ name: "format", value: "summary" }], responseBody: { reportId: "weekly", total: 3, items: [{ id: 1, state: "open" }, { id: 2, state: "closed" }] } }),
    entry({ at: "2026-09-17T16:20:01.000Z", url: "https://diffs.training.example.test/api/reports/weekly?format=detail", queryString: [{ name: "format", value: "detail" }], responseBody: { reportId: "weekly", total: "3", items: [{ id: 1, state: "open", note: "review" }, { id: 3, state: "open" }], generated: true } }),
    entry({ at: "2026-09-17T16:20:02.000Z", url: "https://diffs.training.example.test/api/reports/monthly?format=summary", queryString: [{ name: "format", value: "summary" }], status: 404, statusText: "Not Found", responseBody: { error: "report_not_found", reportId: "monthly" } }),
  ], "Status, nested body, array, added-field, and type-change diffs."),

  "04-redaction-practice.har": har([
    entry({ at: "2026-09-17T16:30:00.000Z", method: "POST", url: "https://redaction.training.example.test/api/login?api_key=TRAINING_QUERY_SECRET", requestHeaders: [header("Content-Type", "application/json"), header("Authorization", "Bearer TRAINING_HEADER_SECRET"), header("X-Request-Id", "safe-training-id")], queryString: [{ name: "api_key", value: "TRAINING_QUERY_SECRET" }], cookies: [{ name: "session", value: "TRAINING_COOKIE_SECRET" }], requestBody: { email: "learner@example.test", password: "TRAINING_PASSWORD", profile: { displayName: "Learner" } }, responseBody: { userId: 42, access_token: "TRAINING_RESPONSE_TOKEN", displayName: "Learner" } }),
    entry({ at: "2026-09-17T16:30:01.000Z", url: "https://redaction.training.example.test/api/profile/42", requestHeaders: [header("Accept", "application/json"), header("Authorization", "Bearer TRAINING_HEADER_SECRET")], cookies: [{ name: "session", value: "TRAINING_COOKIE_SECRET" }], responseBody: { userId: 42, email: "learner@example.test", preferences: { theme: "dark" } } }),
  ], "Synthetic secrets for observing import-time redaction. No value is real."),
};

for (const [name, value] of Object.entries(fixtures)) writeFileSync(join(output, name), `${JSON.stringify(value, null, 2)}\n`);

console.log(`Generated ${Object.keys(fixtures).length} starter HAR files in ${output}`);
