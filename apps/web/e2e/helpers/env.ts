import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function webRoot() {
  if (existsSync(resolve(process.cwd(), "playwright.config.ts"))) {
    return process.cwd();
  }
  if (existsSync(resolve(process.cwd(), "apps/web/playwright.config.ts"))) {
    return resolve(process.cwd(), "apps/web");
  }
  return process.cwd();
}

function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function loadE2eEnv() {
  const web = webRoot();
  loadEnvFile(resolve(web, ".env.local"));
  loadEnvFile(resolve(web, "../../.env.local"));
}

export const AUTH_DIR = resolve(webRoot(), "test-results/.auth");
export const AUTH_FILE = resolve(AUTH_DIR, "user.json");
export const AUTH_META = resolve(AUTH_DIR, "meta.json");
export const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
