import { expect, test } from "@playwright/test";

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`beginner course navigation and saved progress at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.getByRole("button", { name: "CLASSROOM", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Your guided beginner course" })).toBeVisible();
    await page.getByRole("button", { name: "START OR CONTINUE THE BEGINNER COURSE" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Start here: your tools and your first session");
    await expect(page.locator(".guided-lesson ol li")).toHaveCount(5);
    await page.getByText("Reveal the answer", { exact: true }).click();
    await expect(page.locator(".guided-lesson details")).toHaveAttribute("open", "");
    await page.getByRole("button", { name: "I CAN EXPLAIN IT" }).click();
    await expect(page.locator(".guided-lesson [role=status]")).toHaveText("Comfortable");
    await page.getByRole("button", { name: /^NEXT:/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Decide what you are allowed to test");
    await expect(page.locator(".guided-lesson details")).not.toHaveAttribute("open", "");
    await page.reload();
    await page.getByRole("button", { name: "CLASSROOM", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Decide what you are allowed to test");
    await page.getByRole("button", { name: "PREVIOUS LESSON" }).click();
    await expect(page.locator(".guided-lesson [role=status]")).toHaveText("Comfortable");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/classroom-${viewport.width}.png`, fullPage: true });
    await page.getByRole("button", { name: "ALL LESSONS" }).click();
    await page.getByRole("button", { name: /12\. Burp Suite:/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Burp Suite: connect the built-in browser");
    await expect(page.getByRole("heading", { name: "Official references" })).toBeVisible();
    await page.getByRole("button", { name: "ALL LESSONS" }).click();
    await page.getByRole("button", { name: /24\. Capstone:/ }).click();
    await expect(page.getByRole("button", { name: "BACK TO ALL LESSONS" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^NEXT:/ })).toHaveCount(0);
  });
}
