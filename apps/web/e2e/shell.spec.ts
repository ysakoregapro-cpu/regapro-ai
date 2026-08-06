import { test, expect } from "@playwright/test";

/**
 * Smoke E2E for Regapro shell (dev-sample mode).
 * Requires: npm run dev, and `npx playwright install`
 */
test.describe("shell smoke", () => {
  test("home loads without horizontal overflow", async ({ page }) => {
    await page.goto("/home");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });

  test("primary destinations reachable", async ({ page }) => {
    for (const path of ["/home", "/assistant", "/tasks", "/search", "/workspace/knowledge", "/admin"]) {
      await page.goto(path);
      await expect(page.locator("body")).toBeVisible();
    }
  });
});
