import { defineConfig, devices } from "@playwright/test";

/**
 * Browser E2E for apps/web. Not part of `npm test` (Vitest).
 *
 *   npm run e2e:install --workspace=@regapro/web
 *   npm run e2e:release
 *
 * Set PLAYWRIGHT_BASE_URL to run against a port other than 3000 — the dev
 * server it starts follows the same URL, so a different app already listening
 * on 3000 is never mistaken for this one.
 */
// Use localhost (not 127.0.0.1) so Next.js 16 serves /_next chunks in dev.
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const PORT = new URL(BASE_URL).port || "3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  outputDir: "test-results",
  use: {
    baseURL: BASE_URL,
    storageState: "test-results/.auth/user.json",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 12_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: BASE_URL,
    env: { PORT },
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
