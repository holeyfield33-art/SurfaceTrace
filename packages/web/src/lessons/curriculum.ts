export type SkillState = "Not Started" | "Learning" | "Practiced" | "Comfortable";

export interface Lesson {
  id: string;
  title: string;
  track: string;
  level: "foundation" | "intermediate";
  estimatedMinutes: number;
  prerequisites: string[];
  concepts: string[];
  relatedSignals: string[];
  objectives: string[];
  content?: { concept: string; example: string; connection: string; inspect: string; apply: string };
  exercise?: string;
  quickCheck?: string;
}

const tracks: Array<[string, string, string[]]> = [
  ["http", "Web & HTTP Foundations", [
    "How the Web Works", "Anatomy of a URL", "HTTP Requests", "HTTP Responses", "GET vs POST",
    "PUT, PATCH, DELETE", "HTTP Headers", "Status Codes", "Query Parameters", "Request Bodies", "Forms",
    "Content-Type", "Cookies", "Sessions", "Authentication vs Authorization", "Redirects", "Browser Storage",
    "CORS Basics", "Same-Origin Policy", "HTTP Investigation Workflow",
  ]],
  ["javascript", "JavaScript for Bug Hunters", [
    "Variables: const and let", "Strings", "Numbers", "Booleans", "Arrays", "Objects", "Property Access",
    "Functions", "Function Arguments", "Return Values", "if / else", "Comparison Operators", "Logical Operators",
    "Loops", "Array Methods", "JSON", "JSON.parse / JSON.stringify", "Template Literals", "Scope", "Errors and try/catch",
    "The Browser DOM", "document.querySelector", "Reading HTML Elements", "Changing Elements", "Events", "Event Listeners",
    "Forms in JavaScript", "Reading Input Values", "window.location", "URL and URLSearchParams", "fetch()", "GET with fetch",
    "POST with fetch", "Headers with fetch", "JSON API Responses", "async / await", "Promises - beginner mental model",
    "Error Handling with fetch", "document.cookie", "localStorage", "sessionStorage", "Tokens in Browser Applications",
    "Client-Side Routing", "Reading Minified/Bundled Code", "Searching JavaScript for Endpoints", "Finding API Calls",
    "Finding Hidden Parameters", "Finding Feature Flags", "Sources and Source Maps", "JavaScript Investigation Workflow",
  ]],
  ["python", "Python for Bug Hunters", [
    "Variables", "Strings", "Numbers", "Lists", "Dictionaries", "if / else", "Loops", "Functions", "Reading Files",
    "Writing Files", "JSON", "Exceptions", "Imports", "HTTP requests conceptually", "Parsing responses",
    "Small automation scripts", "Comparing data", "Working with URLs", "CLI arguments", "Building a tiny investigation helper",
  ]],
  ["browser", "Browser & DevTools", [
    "Elements", "Network", "Sources", "Application", "Cookies", "Local Storage", "Session Storage", "Console",
    "Request inspection", "Response inspection", "Initiator chains", "XHR/fetch filtering", "JavaScript search", "Breakpoints",
    "Basic DOM inspection",
  ]],
  ["burp", "Burp / Traffic Investigation", [
    "Proxy mental model", "HTTP History", "Repeater", "Request editing", "Response comparison", "Cookies in Burp",
    "Query inputs", "Body inputs", "Headers", "Resource IDs", "Redirects", "Content types", "One-variable experiments", "Notes/evidence",
  ]],
  ["security", "Security Reasoning", [
    "Authentication", "Authorization", "IDOR / BOLA", "CSRF", "XSS", "SQL Injection", "SSRF", "Path Traversal",
    "File Upload", "Open Redirect", "Command Injection", "Template Injection", "Business Logic", "Information Disclosure",
    "Rate Limits", "Race Conditions - conceptual introduction",
  ]],
];

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export const curriculum: Lesson[] = tracks.flatMap(([trackId, track, titles]) => titles.map((title, index) => ({
  id: `${trackId}-${String(index + 1).padStart(2, "0")}-${slug(title)}`,
  title, track, level: index < 20 ? "foundation" : "intermediate", estimatedMinutes: 15,
  prerequisites: index ? [`${trackId}-${String(index).padStart(2, "0")}-${slug(titles[index - 1]!)}`] : [],
  concepts: [slug(title)], relatedSignals: [], objectives: [`Explain ${title} in an investigation context`],
})));

function complete(idPrefix: string, details: NonNullable<Lesson["content"]>, exercise: string, quickCheck: string, signals: string[]): void {
  const lesson = curriculum.find((item) => item.id.startsWith(idPrefix));
  if (lesson) Object.assign(lesson, { content: details, exercise, quickCheck, relatedSignals: signals });
}

complete("http-01-", {
  concept: "A browser resolves a host, opens a connection, sends an HTTP request, and interprets the response.",
  example: "Browser -> DNS -> server -> HTTP response -> rendered page",
  connection: "Every captured request is one observable step in that exchange, not proof of a security flaw.",
  inspect: "Identify the host, method, path, and response status in a request.",
  apply: "Use SurfaceTrace to group repeated observations into endpoints.",
}, "Open one Network request and label each part.", "Which side decides whether a request is authorized?", []);

complete("http-03-", {
  concept: "An HTTP request combines a method, target, headers, and sometimes a body.",
  example: "GET /api/projects/123 HTTP/1.1\nHost: example.test",
  connection: "Inputs can appear in every request component, and each is interpreted by server code.",
  inspect: "Separate method, path, query, headers, cookies, and body.",
  apply: "Compare these parts with SurfaceTrace input descriptors.",
}, "Annotate the parts of a captured request.", "Where is the resource identifier in GET /projects/42?", []);

complete("http-05-", {
  concept: "GET usually retrieves state; POST commonly submits data or requests a state change.",
  example: "POST /profile with a JSON request body",
  connection: "State-changing requests deserve origin, authorization, and replay reasoning.",
  inspect: "Check the method, content type, session context, and resulting status.",
  apply: "SurfaceTrace queues a deterministic state-change hypothesis for POST.",
}, "Find one GET and POST and explain their intent.", "Does POST automatically mean vulnerable?", ["method:POST"]);

complete("http-13-", {
  concept: "Servers set cookies with Set-Cookie; browsers return matching cookies with Cookie.",
  example: "Set-Cookie: session=...; Secure; HttpOnly; SameSite=Lax; Path=/",
  connection: "Session cookies carry identity context. Secure, HttpOnly, SameSite, Path, and scope affect exposure and behavior.",
  inspect: "Record cookie names and attributes, never session values in investigation notes.",
  apply: "SurfaceTrace stores the cookie name and a redacted value signal only.",
}, "Inspect a cookie's attributes in DevTools Application.", "Which attribute prevents JavaScript from reading a cookie?", ["input:cookie"]);

complete("http-14-", {
  concept: "A session connects otherwise independent requests to server-side identity or state.",
  example: "Cookie: session=[REDACTED]",
  connection: "Authorization decisions often depend on session identity, not the URL alone.",
  inspect: "Compare behavior across explicitly authorized test roles without exposing credentials.",
  apply: "Treat a cookie as context, not as evidence of a finding.",
}, "Describe what state the server must associate with a session.", "Is a session the same as authorization?", ["input:cookie"]);

complete("javascript-01-", {
  concept: "const names a value that is not reassigned; let names a value that may change.",
  example: "const endpoint = '/api/users';\nlet status = 200;",
  connection: "Variables often reveal endpoints, object IDs, flags, and request construction.",
  inspect: "const userId = 42; fetch(`/api/users/${userId}`);",
  apply: "Connect userId to the path input shown by SurfaceTrace.",
}, "Find the variable that controls the requested resource.", "Which variable becomes part of the URL?", []);

complete("javascript-16-", {
  concept: "JSON represents nested objects, arrays, strings, numbers, booleans, and null.",
  example: "{ \"profile\": { \"email\": \"person@example.test\" } }",
  connection: "Field paths reveal application-controlled inputs without retaining private values.",
  inspect: "Identify profile.email as a nested field path.",
  apply: "SurfaceTrace records JSON shape paths and inferred types.",
}, "List field paths in a small JSON body.", "What is the path to the email field?", ["input:body-json"]);

complete("security-02-", {
  concept: "Authentication establishes identity; authorization decides what that identity may access.",
  example: "GET /api/projects/123",
  connection: "An object ID is an observation. The security question is whether the server enforces ownership and role access.",
  inspect: "Identify the resource ID and expected access boundary before testing.",
  apply: "Return to the endpoint and review its authorization hypothesis using approved test accounts.",
}, "Write the expected access rule for one object endpoint.", "Does changing an ID alone prove IDOR?", ["signal:object-id-in-path-or-input"]);

export const trackNames = tracks.map(([, name]) => name);

export function lessonById(id: string): Lesson | undefined {
  return curriculum.find((lesson) => lesson.id === id);
}
