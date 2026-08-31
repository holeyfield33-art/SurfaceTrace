import { expect, test } from "@playwright/test";
import { readFileSync, rmSync, mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

const apiToken = "e2e-runtime-token-32-characters-minimum";
const fixture = resolve(process.cwd(), "e2e/fixtures/replay.har");

test("built application completes the guarded investigation workflow", async ({
  page,
  request,
}) => {
  const anonymous = await request.get("http://127.0.0.1:8787/projects");
  expect(anonymous.status()).toBe(401);

  await page.goto("/");
  await expect(page.getByRole("button", { name: "COMMAND CENTER" })).toBeVisible();
  await expect(page.getByText("NO ACTIVE SCOPE - EXECUTION DISABLED").first()).toBeVisible();

  for (const surface of ["INVESTIGATION", "CLASSROOM", "EVIDENCE", "COMMAND CENTER"]) {
    await page.getByRole("button", { name: surface, exact: true }).click();
  }

  await page.locator('input[type="file"]').setInputFiles(fixture);
  await expect(page.getByText("2", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "OPEN INVESTIGATION" }).click();
  await expect(page.getByRole("group", { name: "Attack surface graph" })).toBeVisible();
  await expect(page.getByText("GET /lab/projects/{id}").first()).toBeVisible();

  const observation = page.locator(".http-inspector select").first();
  const identity = page.getByLabel("Observed as", { exact: true });
  await observation.selectOption({ index: 1 });
  await identity.selectOption({ label: "Account A" });
  await expect(page.getByText("Observed as: Account A")).toBeVisible();
  await observation.selectOption({ index: 2 });
  await identity.selectOption({ label: "Account B" });
  await expect(page.getByText("Observed as: Account B")).toBeVisible();

  await page.getByLabel("Identity baseline observation").selectOption({ index: 1 });
  await page.getByLabel("Identity comparison observation").selectOption({ index: 1 });
  await page.getByRole("button", { name: "COMPARE IDENTITIES + SAVE EVIDENCE" }).click();
  await expect(page.getByText("DETERMINISTIC RESPONSE DIFF")).toBeVisible();

  await page.getByRole("button", { name: "COMMAND CENTER", exact: true }).click();
  await page.getByLabel("Candidate URL").fill("http://127.0.0.1:4040/lab/projects/100");
  await page.getByLabel("Candidate method").selectOption("GET");
  await page.getByRole("button", { name: "CHECK SCOPE - NO NETWORK" }).click();
  await expect(page.getByText("OUT OF SCOPE")).toBeVisible();
  await expect(page.getByText(/Request sent: NO/i)).toBeVisible();

  await page.getByLabel("Allowed hosts").fill("127.0.0.1");
  await page.getByLabel("Allowed protocols").fill("http");
  await page.getByLabel("Allowed ports").fill("4040");
  await page.getByLabel("Allowed paths").fill("/lab/");
  await page.getByLabel("Allowed methods").fill("GET");
  await page.getByLabel("Enable active scope").check();
  await page.getByRole("button", { name: "SAVE SCOPE" }).click();
  await expect(page.getByText("ACTIVE SCOPE").first()).toBeVisible();

  await page.getByRole("button", { name: "INVESTIGATION", exact: true }).click();
  await page.getByLabel("Known baseline").selectOption({ index: 1 });
  await page.getByText("One changed input").locator("select").selectOption({ index: 1 });
  await page.getByText("Known value").locator("input").fill("100");
  await page.getByText("Proposed value").locator("input").fill("200");

  const firstPreviewResponse = page.waitForResponse((response) =>
    response.url().includes("/api/replay/prepare"),
  );
  await page.getByRole("button", { name: "PREVIEW ACTIVE REQUEST" }).click();
  const firstPreview = await (await firstPreviewResponse).json();
  await expect(page.getByText("SCOPE ALLOWED")).toBeVisible();
  await page.getByRole("button", { name: "CANCEL" }).click();

  const evidenceBefore = await authenticatedEvidence();
  expect(countSentEvidence(evidenceBefore)).toBe(0);

  const secondPreviewResponse = page.waitForResponse((response) =>
    response.url().includes("/api/replay/prepare"),
  );
  await page.getByRole("button", { name: "PREVIEW ACTIVE REQUEST" }).click();
  const secondPreview = await (await secondPreviewResponse).json();
  await page.getByRole("button", { name: "SEND THIS REQUEST" }).click();
  await expect(page.getByText("RESPONSE 200")).toBeVisible();

  const reused = await authenticatedFetch(`/replay/${secondPreview.token}/send`, {
    method: "POST",
    body: JSON.stringify({ approval: true }),
  });
  expect(reused.ok).toBeFalsy();
  const evidenceAfter = await authenticatedEvidence();
  expect(countSentEvidence(evidenceAfter)).toBe(1);
  expect(JSON.stringify(evidenceAfter)).not.toContain("runtime-only-secret");
  expect(await page.locator("body").innerText()).not.toContain(apiToken);
  expect(firstPreview.token).not.toBe(secondPreview.token);

  const inventoryResponse = await authenticatedFetch("/inventory");
  const inventory = await inventoryResponse.json();
  const redirectPreview = await authenticatedFetch("/replay/prepare", {
    method: "POST",
    body: JSON.stringify({
      baselineObservationId: inventory.observations[0].id,
      mutation: {
        pathParam: { name: "id", from: "100", to: "redirect" },
      },
    }),
  });
  expect(redirectPreview.ok).toBeTruthy();
  const redirectToken = (await redirectPreview.json()).token;
  const redirectResult = await authenticatedFetch(`/replay/${redirectToken}/send`, {
    method: "POST",
    body: JSON.stringify({ approval: true }),
  });
  expect(redirectResult.ok).toBeTruthy();
  const redirect = await redirectResult.json();
  expect(redirect.response.status).toBe(302);
  expect(redirect.redirect.proposed).toContain("/lab/projects/100");

  await page.getByRole("button", { name: "CLASSROOM", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Learn what the traffic is telling you." })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "EVIDENCE", exact: true }).click();
  await expect(page.getByText(/hash-linked/i).first()).toBeVisible();
});

test("isolated API restart restores persisted investigation state", async () => {
  const directory = mkdtempSync(join(tmpdir(), "surfacetrace-e2e-restart-"));
  const database = join(directory, "restart.db");
  const port = await availablePort();
  let api: ChildProcess | undefined;
  try {
    api = startApi(port, database);
    await waitForHealth(port);
    const imported = await fetch(`http://127.0.0.1:${port}/import/har`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ har: readFileSync(fixture, "utf8"), sourceLabel: "restart-e2e" }),
    });
    expect(imported.status).toBe(200);
    await stop(api);
    api = startApi(port, database);
    await waitForHealth(port);
    const inventory = await fetch(`http://127.0.0.1:${port}/inventory`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    expect(inventory.ok).toBeTruthy();
    expect((await inventory.json()).observations).toHaveLength(2);
  } finally {
    if (api?.exitCode === null) await stop(api);
    rmSync(directory, { force: true, recursive: true });
  }
});

async function authenticatedEvidence() {
  const response = await authenticatedFetch("/evidence");
  expect(response.ok).toBeTruthy();
  return response.json();
}

function authenticatedFetch(path: string, init: RequestInit = {}) {
  return fetch(`http://127.0.0.1:8787${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

function countSentEvidence(result: { records: Array<{ payload: unknown }> }): number {
  return result.records.filter((record) =>
    JSON.stringify(record.payload).includes('"event":"replay_request_sent"'),
  ).length;
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveReady) => {
    server.listen(0, "127.0.0.1", resolveReady);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No TCP port allocated");
  await new Promise<void>((resolveClosed) => {
    server.close(() => resolveClosed());
  });
  return address.port;
}

function startApi(port: number, database: string): ChildProcess {
  return spawn(process.execPath, ["packages/server/dist/index.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      SURFACETRACE_API_TOKEN: apiToken,
      SURFACETRACE_DB_PATH: database,
    },
    stdio: "ignore",
  });
}

async function waitForHealth(port: number): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      // The process may still be binding its loopback listener.
    }
    await new Promise((resolveWait) => {
      setTimeout(resolveWait, 50);
    });
  }
  throw new Error(`API did not start on loopback port ${port}`);
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill();
  await new Promise<void>((resolveExit, rejectExit) => {
    const timer = setTimeout(() => rejectExit(new Error("API did not stop")), 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolveExit();
    });
  });
}
