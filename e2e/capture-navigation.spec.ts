import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

test("capture can become the investigation source and be cleared without losing its HAR", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "CAPTURES", exact: true }).click();
  await page.getByLabel("Capture identity").selectOption("ACCOUNT_A");
  await page.getByLabel("Complete HAR").setInputFiles(resolve(process.cwd(), "e2e/fixtures/replay.har"));
  await page.getByRole("button", { name: "IMPORT PRIVATE HAR" }).click();
  await expect(page.getByText("VIEWING: replay.har")).toBeVisible();
  await page.getByLabel("Captured endpoint").selectOption({ index: 1 });
  await expect(page.getByRole("heading", { name: "Viewing replay.har" })).toBeVisible();
  await page.getByRole("button", { name: "OPEN IN INVESTIGATION" }).click();
  await expect(page.getByRole("heading", { name: "HTTP inspector" })).toBeVisible();
  await page.getByRole("button", { name: "COMMAND CENTER", exact: true }).click();
  await expect(page.getByText("Capture: replay.har (ACCOUNT_A)")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "CLEAR INVESTIGATION IMPORTS" }).click();
  await expect(page.getByText("No HAR selected for Investigation")).toBeVisible();
  await page.getByRole("button", { name: "CAPTURES", exact: true }).click();
  await expect(page.getByText("VIEWING: replay.har")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "REMOVE FROM VIEW" }).click();
  await expect(page.getByText("VIEWING: replay.har")).toHaveCount(0);
  await page.getByText(/Archived captures/).click();
  await page.getByRole("button", { name: "RESTORE" }).click();
  await expect(page.getByText("VIEWING: replay.har")).toBeVisible();
});
