/**
 * Non-destructive smoke checks for temporary REGAPRO_DATA_MODE=supabase.
 * Does NOT log in with passwords or mutate org/admin data.
 *
 * Usage: node scripts/smoke-supabase-mode.mjs
 * Optional: SMOKE_BASE_URL=http://127.0.0.1:3000
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const base = (process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000").replace(
  /\/$/,
  "",
);

function loadEnvFile(filePath) {
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

loadEnvFile(resolve(root, "apps/web/.env.local"));
loadEnvFile(resolve(root, ".env.local"));

function ok(msg) {
  console.log(`OK: ${msg}`);
}

function warn(msg) {
  console.warn(`WARN: ${msg}`);
}

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exitCode = 1;
}

async function tryFetch(path, init) {
  try {
    const res = await fetch(`${base}${path}`, init);
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* ignore */
    }
    return { res, text, json };
  } catch (err) {
    return {
      res: null,
      text: "",
      json: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  console.log(`Smoke base: ${base}`);

  const mode =
    process.env.REGAPRO_DATA_MODE ||
    process.env.NEXT_PUBLIC_REGAPRO_DATA_MODE ||
    "(unset→dev-sample)";
  console.log(`REGAPRO_DATA_MODE effective hint: ${mode}`);

  const health = await tryFetch("/api/health");
  if (health.error) {
    warn(`Server not reachable (${health.error}). Start npm run dev for live HTTP checks.`);
  } else if (health.res?.ok) {
    ok(`/api/health → ${health.res.status}`);
  } else {
    fail(`/api/health → ${health.res?.status ?? "?"}`);
  }

  const session = await tryFetch("/api/auth/session");
  if (session.error) {
    warn("Skip session check (server down)");
  } else if (session.res?.status === 401 || session.json?.mode === "supabase") {
    ok(
      `/api/auth/session unauthenticated or mode reported (${session.res?.status}, mode=${session.json?.mode ?? "n/a"})`,
    );
  } else if (session.json?.mode === "dev-sample") {
    warn(
      "Session reports dev-sample — set REGAPRO_DATA_MODE=supabase temporarily for live UI validation",
    );
  } else {
    ok(`/api/auth/session → ${session.res?.status}`);
  }

  for (const path of [
    "/api/chat/threads",
    "/api/tasks",
    "/api/artifacts",
    "/api/research",
  ]) {
    const r = await tryFetch(path);
    if (r.error) {
      warn(`Skip ${path} (server down)`);
      continue;
    }
    if (r.res?.status === 401 || r.res?.status === 403) {
      ok(`${path} rejects unauthenticated (${r.res.status})`);
      const body = r.text;
      if (/postgrest|PGRST|service_role|supabase\.co\/rest/i.test(body)) {
        fail(`${path} leaked internal error details`);
      }
    } else if (mode.includes("supabase") && r.res?.ok && r.json?.ok) {
      warn(
        `${path} returned 200 without session — verify auth gating if this is unexpected`,
      );
    } else {
      ok(`${path} → ${r.res?.status} (body sanitized check skipped)`);
    }
  }

  if (process.exitCode) {
    console.error("Smoke finished with failures");
    process.exit(process.exitCode);
  }
  console.log("Smoke finished");
}

await main();
