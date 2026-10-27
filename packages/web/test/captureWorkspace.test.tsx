import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { CaptureWorkspace } from "../src/CaptureWorkspace";

afterEach(() => vi.unstubAllGlobals());

test("shows A/B profile provenance while leaving public feeds low priority", async () => {
  const index = {
    campaign: { name: "NBA" },
    profile: { credentialHosts: [], authCookiePattern: "session", tokenFieldPattern: "jwt", profilePaths: [], profileIdFields: [], excludedHosts: ["payment.nba.com"], extraRedactNames: [], scopeNote: "scope CSV" },
    captures: [
      { id: "capture-a", sourceFilename: "a.har", captureIdentity: "ACCOUNT_A", importedAt: "2026-09-29", capturedAt: "2026-09-29", observationCount: 2, endpointCount: 2, authFingerprints: [], tokenFingerprints: [], identityConsistency: "UNKNOWN", warnings: [], rawSha256: "abc", rawReference: "private/a.har" },
      { id: "capture-b", sourceFilename: "b.har", captureIdentity: "ACCOUNT_B", importedAt: "2026-09-28", capturedAt: "2026-09-28", observationCount: 1, endpointCount: 1, authFingerprints: [], tokenFingerprints: [], identityConsistency: "UNKNOWN", warnings: [], rawSha256: "def", rawReference: "private/b.har" },
    ], ownershipRelationships: [], archivedCaptures: [],
    endpoints: [
      { id: "profile", method: "GET", host: "identity.nba.com", pathTemplate: "/api/v1/profile" },
      { id: "feed", method: "GET", host: "cdn.nba.com", pathTemplate: "/static/json/liveData/scoreboard.json" },
      { id: "payment", method: "GET", host: "payment.nba.com", pathTemplate: "/transactionhistory" },
    ],
    observations: [
      { id: "a", captureId: "capture-a", captureIdentity: "ACCOUNT_A", requestAuthState: "PRESENT", authFingerprints: ["nbaidentity:123"], tokenFingerprints: [], sequence: 0, endpointId: "profile", method: "GET", url: "https://identity.nba.com/api/v1/profile", pathTemplate: "/api/v1/profile", responseStatus: 200, responseBodyShape: '{"data":{"result":{"email":"string"}}}', requestBodyShape: null, capturedAt: "2026-09-29", parsedInputs: [], http: { request: { body: null, headers: {} }, response: { body: null, headers: {} } } },
      { id: "b", captureId: "capture-b", captureIdentity: "ACCOUNT_B", requestAuthState: "PRESENT", authFingerprints: ["nbaidentity:456"], tokenFingerprints: [], sequence: 0, endpointId: "profile", method: "GET", url: "https://identity.nba.com/api/v1/profile", pathTemplate: "/api/v1/profile", responseStatus: 200, responseBodyShape: '{"data":{"result":{"email":"string"}}}', requestBodyShape: null, capturedAt: "2026-09-29", parsedInputs: [], http: { request: { body: null, headers: {} }, response: { body: null, headers: {} } } },
      { id: "feed-a", captureId: "capture-a", captureIdentity: "ACCOUNT_A", requestAuthState: "NONE", authFingerprints: [], tokenFingerprints: [], sequence: 1, endpointId: "feed", method: "GET", url: "https://cdn.nba.com/static/json/liveData/scoreboard.json", pathTemplate: "/static/json/liveData/scoreboard.json", responseStatus: 200, responseBodyShape: null, requestBodyShape: null, capturedAt: "2026-09-29", parsedInputs: [], http: { request: { body: null, headers: {} }, response: { body: null, headers: {} } } },
      { id: "payment-a", captureId: "capture-a", captureIdentity: "ACCOUNT_A", requestAuthState: "NONE", authFingerprints: [], tokenFingerprints: [], sequence: 2, endpointId: "payment", method: "GET", url: "https://payment.nba.com/transactionhistory", pathTemplate: "/transactionhistory", responseStatus: 200, responseBodyShape: null, requestBodyShape: null, capturedAt: "2026-09-29", parsedInputs: [], http: { request: { body: null, headers: {} }, response: { body: null, headers: {} } } },
    ],
  };
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => index })));
  render(<CaptureWorkspace />);
  const user = userEvent.setup();
  expect(await screen.findByText("VIEWING: a.har")).toBeTruthy();
  await user.selectOptions(await screen.findByLabelText("Captured endpoint"), "profile");
  expect(screen.getByText(/Both controlled capture contexts are available/)).toBeTruthy();
  expect(screen.getByText(/Request authentication:/)).toBeTruthy();
  await user.selectOptions(screen.getByLabelText("Captured endpoint"), "feed");
  expect(screen.getByText(/Account A\/B comparison has low authorization priority/)).toBeTruthy();
  expect(screen.getByText(/Request authentication:/)).toBeTruthy();
  await user.selectOptions(screen.getByLabelText("Captured endpoint"), "payment");
  expect(screen.getByText(/EXPLICITLY OUT OF SCOPE/)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "VIEW HAR" }));
  expect(screen.getByText("VIEWING: b.har")).toBeTruthy();
  expect(screen.queryByText("VIEWING: a.har")).toBeNull();
  expect(screen.getByRole("heading", { name: "Viewing b.har" })).toBeTruthy();
  expect(screen.queryAllByRole("option", { name: /cdn.nba.com/ })).toHaveLength(0);
});
