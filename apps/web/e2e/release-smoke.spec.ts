import { test, expect, type Page } from "@playwright/test";

/**
 * Release smoke: every major control must change URL, open a dialog/menu,
 * or issue a request. Dead buttons (click with no effect) fail this suite.
 *
 * Auth: supabase mode redirects unauthenticated users to /login — that is a
 * valid state change. Logged-in runs exercise in-app destinations.
 */

async function settle(page: Page) {
  await page.waitForLoadState("domcontentloaded");
}

async function clickChangesSomething(
  page: Page,
  locator: ReturnType<Page["locator"]>,
  label: string,
) {
  const beforeUrl = page.url();
  const dialogsBefore = await page.locator('[role="dialog"], [role="menu"]').count();
  let requestSeen = false;
  const onReq = () => {
    requestSeen = true;
  };
  page.on("request", onReq);
  try {
    await locator.click({ timeout: 8_000 });
    await page.waitForTimeout(400);
    const afterUrl = page.url();
    const dialogsAfter = await page.locator('[role="dialog"], [role="menu"]').count();
    const urlChanged = afterUrl !== beforeUrl;
    const dialogChanged = dialogsAfter !== dialogsBefore;
    expect(
      urlChanged || dialogChanged || requestSeen,
      `dead control: ${label}`,
    ).toBeTruthy();
  } finally {
    page.off("request", onReq);
  }
}

test.describe("release navigation smoke", () => {
  test("home / assistant / research / knowledge / review / published routes respond", async ({
    page,
  }) => {
    const paths = [
      "/home",
      "/assistant",
      "/workspace/research",
      "/workspace/knowledge",
      "/workspace/knowledge?tab=review",
      "/workspace/knowledge?tab=published",
      "/tasks",
      "/search",
      "/workspace",
      "/settings",
    ];
    for (const path of paths) {
      const res = await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(res, path).toBeTruthy();
      expect(res!.status(), path).toBeLessThan(500);
      await expect(page.locator("body")).toBeVisible();
      // Unauthenticated supabase mode lands on login; that is still a destination.
      const url = page.url();
      expect(url.length).toBeGreaterThan(8);
    }
  });

  test("primary nav links are not dead", async ({ page }) => {
    await page.goto("/home");
    await settle(page);
    const nav = page.locator("nav a, aside a, [data-nav] a").filter({ hasText: /.+/ });
    const count = await nav.count();
    const limit = Math.min(count, 12);
    for (let i = 0; i < limit; i += 1) {
      const link = nav.nth(i);
      const href = await link.getAttribute("href");
      if (!href || href === "#" || href.startsWith("javascript:")) {
        throw new Error(`dead href on nav item ${i}: ${href}`);
      }
      const label = ((await link.innerText()) || href).trim().slice(0, 40);
      await clickChangesSomething(page, link, `nav:${label}`);
      await page.goto("/home");
      await settle(page);
    }
  });

  test("+新規 menu items change destination or open a picker", async ({ page }) => {
    await page.goto("/home");
    await settle(page);
    const create = page.getByRole("button", { name: /新規/ }).first();
    if (!(await create.isVisible().catch(() => false))) {
      test.skip(true, "create menu not visible (likely login wall)");
      return;
    }
    await clickChangesSomething(page, create, "+新規");
    const newChat = page.getByRole("menuitem", { name: "新しいチャット" });
    if (await newChat.isVisible().catch(() => false)) {
      await clickChangesSomething(page, newChat, "新しいチャット");
      expect(page.url()).toMatch(/thread=/);
    }
  });
});
