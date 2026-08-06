import { defineConfig, devices } from "@playwright/test";

/**
 * E2E suites live only under apps/web/e2e.
 * Require browsers + running app. Not executed as part of npm test.
 *
 * Commands:
 *   npx playwright install
 *   npm run dev
 *   npx playwright test --config=apps/web/playwright.config.ts
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium-390", use: { ...devices["iPhone 12"] } },
    { name: "chromium-768", use: { viewport: { width: 768, height: 1024 } } },
    { name: "chromium-1440", use: { viewport: { width: 1440, height: 900 } } },
  ],
});
