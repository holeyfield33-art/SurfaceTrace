import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`personal lab notes persist and download at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "OPEN MY LAB NOTES" }).click();
    await page.getByLabel("Lab title").fill("My first comparison");
    await page.getByLabel("Target", { exact: true }).fill("Owned local lab");
    await page.getByLabel("Observed facts", { exact: true }).fill("Both records returned 200.\nNames differ.");
    await expect(page.locator(".lab-notes [role=status]")).toHaveText("Saved in this browser.");
    await page.getByRole("button", { name: "NEW LAB NOTE" }).click();
    await expect(page.getByLabel("Target", { exact: true })).toHaveValue("");
    await page.getByLabel("Choose a lab").selectOption({ label: "My first comparison" });
    await page.getByRole("button", { name: "COMMAND CENTER", exact: true }).click();
    await page.getByRole("button", { name: "NOTES", exact: true }).click();
    await expect(page.getByLabel("Target", { exact: true })).toHaveValue("Owned local lab");
    await page.reload();
    await page.getByRole("button", { name: "NOTES", exact: true }).click();
    await expect(page.getByLabel("Observed facts", { exact: true })).toHaveValue("Both records returned 200.\nNames differ.");
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "DOWNLOAD THIS NOTE (.TXT)" }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe("My-first-comparison.txt");
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString("utf8")).toContain("Inferences:\nNone yet.");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/notes-${width}.png`, fullPage: true });
  });
}

test("scope walkthrough preserves first-save feedback, catches errors, and checks saved rules only", async ({ page }) => {
  let saves = 0;
  let previews = 0;
  let targetRequests = 0;
  page.on("request", (request) => { if (request.url().startsWith("http://127.0.0.1:4040/")) targetRequests++; });
  await page.route("**/api/scope", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { scope: null } });
    saves++;
    if (saves === 1) return route.abort();
    return route.fulfill({ json: { scope: { ...route.request().postDataJSON(), id: "local-test-scope" } } });
  });
  await page.route("**/api/scope/preview", async (route) => {
    previews++;
    if (previews === 1) return route.fulfill({ status: 400, json: { error: "Example API validation failure" } });
    return route.fulfill({ json: { requestSent: false, decision: { allowed: true, reasonCode: "ALLOWED", reason: "Candidate matches the saved local lab scope." } } });
  });
  await page.goto("/");
  const panel = page.locator(".scope-panel");
  await panel.getByRole("button", { name: "FILL LOCAL LAB EXAMPLE" }).click();
  await expect(page.getByLabel("Allowed ports", { exact: true })).toHaveValue("4040");
  await expect(page.getByLabel("Enable active scope", { exact: true })).not.toBeChecked();
  expect(saves).toBe(0);
  await panel.getByRole("button", { name: "CHECK SCOPE - NO NETWORK" }).click();
  await expect(panel.getByText("Save your scope edits first.", { exact: false })).toBeVisible();
  expect(previews).toBe(0);
  await page.getByLabel("Enable active scope", { exact: true }).check();
  await panel.getByRole("button", { name: "SAVE SCOPE" }).click();
  await expect(panel.getByText(/local API could not complete/)).toBeVisible();
  await expect(page.getByLabel("Allowed ports", { exact: true })).toHaveValue("4040");
  await panel.getByRole("button", { name: "SAVE SCOPE" }).click();
  await expect(panel.getByText("Scope saved. No request was sent.")).toBeVisible();
  await panel.getByRole("button", { name: "CHECK SCOPE - NO NETWORK" }).click();
  await expect(panel.getByText("Example API validation failure")).toBeVisible();
  await panel.getByRole("button", { name: "CHECK SCOPE - NO NETWORK" }).click();
  await expect(panel.getByText("IN SCOPE", { exact: true })).toBeVisible();
  await expect(panel.getByText("Request sent: NO", { exact: true })).toBeVisible();
  await page.getByLabel("Candidate URL", { exact: true }).fill("http://127.0.0.1:4040/lab/projects/100");
  await expect(panel.getByText("IN SCOPE", { exact: true })).toHaveCount(0);
  expect(targetRequests).toBe(0);
  await page.setViewportSize({ width: 390, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await panel.screenshot({ path: "test-results/scope-guide-mobile.png" });
});
