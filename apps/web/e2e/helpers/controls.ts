import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import { redactText, redactUrl } from "./redact";

export async function settle(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("load").catch(() => undefined);
}

export function threadIdFromUrl(url: string): string | null {
  try {
    return new URL(url).searchParams.get("thread");
  } catch {
    return null;
  }
}

export function attachDiagnostics(page: Page, testInfo: TestInfo) {
  const consoleErrors: string[] = [];
  const networkFailures: { url: string; error: string }[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(redactText(msg.text()));
  });
  page.on("pageerror", (err) => {
    consoleErrors.push(redactText(err.message));
  });
  page.on("requestfailed", (req) => {
    const failure = req.failure()?.errorText ?? "failed";
    if (/ERR_ABORTED|net::ERR_ABORTED/i.test(failure)) return;
    networkFailures.push({
      url: redactUrl(req.url()),
      error: redactText(failure),
    });
  });

  return {
    consoleErrors,
    networkFailures,
    async flushOnFailure() {
      await testInfo.attach("failing-url", {
        body: redactUrl(page.url()),
        contentType: "text/plain",
      });
      await testInfo.attach("console-errors", {
        body: JSON.stringify(consoleErrors, null, 2),
        contentType: "application/json",
      });
      await testInfo.attach("network-failures", {
        body: JSON.stringify(networkFailures, null, 2),
        contentType: "application/json",
      });
    },
  };
}

function isAppRequest(url: string) {
  return !url.includes("/_next/") && !url.includes("/__next");
}

/**
 * Click must produce URL change, request, dialog/menu, file chooser,
 * or a visible state change. Disabled controls need an explicit reason.
 */
export async function clickChangesSomething(
  page: Page,
  locator: Locator,
  label: string,
  opts?: { expectFileChooser?: boolean },
) {
  const disabled = await locator.isDisabled().catch(() => false);
  if (disabled) {
    const reason =
      (await locator.getAttribute("title")) ||
      (await locator.getAttribute("aria-description")) ||
      (await locator.innerText().catch(() => ""));
    expect(reason.trim().length, `disabled without reason: ${label}`).toBeGreaterThan(0);
    return { kind: "disabled" as const };
  }

  const beforeUrl = page.url();
  const dialogsBefore = await page.locator('[role="dialog"], [role="menu"]').count();
  const classBefore = (await locator.getAttribute("class")) ?? "";
  const pressedBefore = await locator.getAttribute("aria-pressed");
  const expandedBefore = await locator.getAttribute("aria-expanded");
  let requestSeen = false;
  const onReq = (req: { url: () => string }) => {
    if (isAppRequest(req.url())) requestSeen = true;
  };
  page.on("request", onReq);

  try {
    if (opts?.expectFileChooser) {
      const chooserPromise = page.waitForEvent("filechooser", { timeout: 8_000 });
      await locator.click({ timeout: 8_000 });
      await chooserPromise;
      return { kind: "filechooser" as const };
    }

    await locator.click({ timeout: 8_000 });

    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      const afterUrl = page.url();
      const urlChanged = afterUrl !== beforeUrl;
      const dialogsAfter = await page.locator('[role="dialog"], [role="menu"]').count();
      const dialogChanged = dialogsAfter !== dialogsBefore;
      const attrs = await locator
        .evaluate(
          (el) => ({
            className: el.getAttribute("class") ?? "",
            pressed: el.getAttribute("aria-pressed"),
            expanded: el.getAttribute("aria-expanded"),
          }),
          undefined,
          { timeout: 400 },
        )
        .catch(() => null);
      const stateChanged =
        attrs !== null &&
        (attrs.className !== classBefore ||
          attrs.pressed !== pressedBefore ||
          attrs.expanded !== expandedBefore);
      if (urlChanged || dialogChanged || requestSeen || stateChanged) {
        return {
          kind: urlChanged
            ? ("url" as const)
            : dialogChanged
              ? ("dialog" as const)
              : requestSeen
                ? ("request" as const)
                : ("state" as const),
        };
      }
      await page.waitForTimeout(150);
    }

    expect(false, `dead control: ${label}`).toBeTruthy();
    return { kind: "state" as const };
  } finally {
    page.off("request", onReq);
  }
}
