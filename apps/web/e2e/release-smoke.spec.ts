import { test as base, expect, type Page } from "@playwright/test";
import {
  attachDiagnostics,
  clickChangesSomething,
  settle,
  threadIdFromUrl,
} from "./helpers/controls";

const test = base.extend<{ diagnostics: ReturnType<typeof attachDiagnostics> }>({
  diagnostics: async ({ page }, use, testInfo) => {
    const diag = attachDiagnostics(page, testInfo);
    await use(diag);
    if (diag.consoleErrors.length > 0 || diag.networkFailures.length > 0) {
      await testInfo.attach("console-errors", {
        body: JSON.stringify(diag.consoleErrors, null, 2),
        contentType: "application/json",
      });
      await testInfo.attach("network-failures", {
        body: JSON.stringify(diag.networkFailures, null, 2),
        contentType: "application/json",
      });
    }
    if (testInfo.status !== testInfo.expectedStatus) {
      await diag.flushOnFailure();
    }
  },
});

test.use({ viewport: { width: 1440, height: 900 } });

const INTERNAL_Q =
  "Web検索は使わず、公開済みの社内Knowledgeだけを使ってレガプロの有料職業紹介事業の基本業務を整理して";

const HOME_SHORTCUTS = [
  "社内情報を探す",
  "Webで調べる",
  "タスクを管理する",
  "文面を作る",
  "資料を作る",
  "コードを作る",
  "AI向け指示書を作る",
  "ファイルを追加する",
] as const;

const ASSISTANT_SHORTCUTS = HOME_SHORTCUTS;

async function expectLoggedInHome(page: Page) {
  await page.goto("/home");
  await settle(page);
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

function headerCreate(page: Page) {
  return page.locator("header").getByRole("button", { name: /新規/ }).first();
}

test.describe("release smoke", () => {
  test("home displays work-first heading", async ({ page, diagnostics }) => {
    void diagnostics;
    await expectLoggedInHome(page);
    await expect(page.getByRole("button", { name: "新しく依頼する" })).toBeVisible();
  });

  test("major routes respond without 5xx", async ({ page, diagnostics }) => {
    void diagnostics;
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
      expect(page.url()).not.toMatch(/\/login/);
    }
  });

  test("sidebar and header navigation are not dead", async ({ page, diagnostics }) => {
    void diagnostics;
    test.setTimeout(120_000);
    await expectLoggedInHome(page);
    const nav = page.locator("aside[aria-label='メインナビゲーション'] a");
    const count = await nav.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      await page.goto("/home");
      await settle(page);
      const href = await nav.nth(i).getAttribute("href");
      expect(href, `nav ${i}`).toBeTruthy();
      expect(href).not.toBe("#");
      const start = href === "/home" || href?.startsWith("/home?") ? "/tasks" : "/home";
      if (start !== "/home") {
        await page.goto(start);
        await settle(page);
      }
      const link = nav.nth(i);
      const label = ((await link.innerText()) || href || "").trim().slice(0, 40);
      await clickChangesSomething(page, link, `sidebar:${label}`);
      await expect(page, `sidebar:${label}`).toHaveURL(
        (url) => {
          const path = url.pathname;
          if (href === "/home") return path === "/home";
          return path === href || path.startsWith(`${href}/`);
        },
        { timeout: 15_000 },
      );
    }

    await page.goto("/home");
    await clickChangesSomething(
      page,
      page.locator("header").getByRole("button", { name: "プロジェクト" }),
      "header:プロジェクト",
    );
    await clickChangesSomething(
      page,
      page.locator("header").getByRole("button", { name: "コマンドパレット" }),
      "header:検索",
    );
    await page.keyboard.press("Escape");
    await clickChangesSomething(
      page,
      page.locator("header").getByRole("button", { name: /通知/ }),
      "header:通知",
    );
  });

  test("Knowledge / Review / Published tabs change state", async ({ page, diagnostics }) => {
    void diagnostics;
    await page.goto("/workspace/knowledge");
    await settle(page);
    await expect(page.getByRole("heading", { name: "ナレッジ" })).toBeVisible();

    await page.locator("nav").getByRole("button", { name: "レビュー", exact: true }).click();
    await expect(page).toHaveURL(/tab=review/);
    await expect(page.getByRole("heading", { name: "レビュー" })).toBeVisible();

    await page.locator("nav").getByRole("button", { name: "公開ナレッジ" }).click();
    await expect(page).toHaveURL(/tab=published/);
    await expect(page.getByText("下書き → レビュー → 承認 → 公開")).toBeVisible();
  });

  test("Home 新しく依頼する creates a blank thread", async ({ page, diagnostics }) => {
    void diagnostics;
    await expectLoggedInHome(page);
    await page.getByRole("button", { name: "新しく依頼する" }).click();
    await page.waitForURL(/\/assistant\?.*thread=/, { timeout: 20_000 });
    const threadId = threadIdFromUrl(page.url());
    expect(threadId).toBeTruthy();
    await expect(page.getByTestId("user-message")).toHaveCount(0);
    await expect(page.getByTestId("assistant-message")).toHaveCount(0);
  });

  test("home shortcuts are not dead", async ({ page, diagnostics }) => {
    void diagnostics;
    test.setTimeout(180_000);
    for (const label of HOME_SHORTCUTS) {
      await page.goto("/home");
      await settle(page);
      const btn = page.getByRole("button", { name: label });
      await expect(btn, label).toBeVisible();
      const result = await clickChangesSomething(page, btn, `home-shortcut:${label}`, {
        expectFileChooser: label === "ファイルを追加する",
      });
      if (label === "ファイルを追加する") {
        expect(result.kind, label).toBe("filechooser");
      } else {
        await page.waitForURL(/\/assistant\?.*thread=/, { timeout: 20_000 });
        expect(threadIdFromUrl(page.url()), label).toBeTruthy();
      }
    }
  });

  test("assistant shortcut chips change state or open a picker", async ({
    page,
    diagnostics,
  }) => {
    void diagnostics;
    test.setTimeout(120_000);
    await expectLoggedInHome(page);
    await page.getByRole("button", { name: "新しく依頼する" }).click();
    await page.waitForURL(/\/assistant\?.*thread=/, { timeout: 20_000 });
    for (const label of ASSISTANT_SHORTCUTS) {
      const chip = page.getByRole("button", { name: label });
      await expect(chip, label).toBeVisible();
      const result = await clickChangesSomething(page, chip, `assistant-chip:${label}`);
      expect(["state", "filechooser", "url", "request", "dialog"]).toContain(result.kind);
    }
  });
});

test.describe("release smoke live paths", () => {
  test.describe.configure({ mode: "serial" });

  let threadA: string | null = null;

  test("internal-only live runtime + citation persistence", async ({
    page,
    diagnostics,
  }) => {
    void diagnostics;
    test.setTimeout(180_000);
    await expectLoggedInHome(page);
    await page.getByRole("button", { name: "新しく依頼する" }).click();
    await page.waitForURL(/\/assistant\?.*thread=/, { timeout: 20_000 });
    threadA = threadIdFromUrl(page.url());
    expect(threadA).toBeTruthy();

    await page.locator("#assistant-input").fill(INTERNAL_Q);
    await page.getByRole("button", { name: "送信" }).click();
    await expect(page.getByTestId("user-message")).toContainText("有料職業紹介", {
      timeout: 15_000,
    });
    await expect(page.getByTestId("assistant-message")).toBeVisible({
      timeout: 180_000,
    });
    const assistantText = await page.getByTestId("assistant-message").first().innerText();
    expect(assistantText).not.toMatch(/knowledge:\/\//i);
    expect(assistantText).not.toMatch(/AI モデル本体が未接続/);
    expect(assistantText).not.toMatch(/確認用データで調査フロー/);
    await expect(page.getByTestId("citation-pane")).toContainText("社内情報");

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(new RegExp(`thread=${threadA}`));
    await expect(page.getByTestId("user-message")).toBeVisible();
    await expect(page.getByTestId("assistant-message")).toBeVisible();
    await expect(page.getByTestId("citation-pane")).toContainText("社内情報");
    const reloaded = await page.getByTestId("assistant-message").first().innerText();
    expect(reloaded).not.toMatch(/knowledge:\/\//i);
  });

  test("+新規 新しいチャット creates a distinct blank thread", async ({
    page,
    diagnostics,
  }) => {
    void diagnostics;
    expect(threadA).toBeTruthy();
    await page.goto(`/assistant?thread=${threadA}`);
    await settle(page);
    await headerCreate(page).click();
    await expect(page.getByRole("menuitem", { name: "新しいチャット" })).toBeVisible();
    await page.getByRole("menuitem", { name: "新しいチャット" }).click();
    await page.waitForURL(
      (url) => {
        const id = url.searchParams.get("thread");
        return url.pathname === "/assistant" && Boolean(id) && id !== threadA;
      },
      { timeout: 20_000 },
    );
    const threadB = threadIdFromUrl(page.url());
    expect(threadB).toBeTruthy();
    expect(threadB).not.toBe(threadA);
    await expect(page.getByTestId("user-message")).toHaveCount(0);
    await expect(page.getByTestId("assistant-message")).toHaveCount(0);
  });

  test("+新規 詳細調査 enters research workflow without demo copy", async ({
    page,
    diagnostics,
  }) => {
    void diagnostics;
    await page.goto("/home");
    await settle(page);
    await headerCreate(page).click();
    await page.getByRole("menuitem", { name: "詳細調査を開始" }).click();
    await page.waitForURL(
      (url) =>
        url.pathname === "/assistant" &&
        Boolean(url.searchParams.get("thread")) &&
        url.searchParams.get("tool") === "web_research",
      { timeout: 20_000 },
    );
    expect(page.url()).toMatch(/tool=web_research/);
    await expect(page.getByText("調べたい内容を入力してください")).toBeVisible();
    await expect(page.getByText("確認用データで調査フロー")).toHaveCount(0);
    await expect(page.getByText("実際のWeb検索はまだ接続されていません")).toHaveCount(0);
  });

  test("+新規 ファイルを追加 opens a file picker", async ({ page, diagnostics }) => {
    void diagnostics;
    await page.goto("/home");
    await settle(page);
    await headerCreate(page).click();
    const result = await clickChangesSomething(
      page,
      page.getByRole("menuitem", { name: "ファイルを追加" }),
      "+新規:ファイルを追加",
      { expectFileChooser: true },
    );
    expect(result.kind).toBe("filechooser");
  });
});
