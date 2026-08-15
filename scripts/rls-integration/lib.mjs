/**
 * Shared helpers for authenticated RLS integration tests.
 * Fixture setup/cleanup may use service_role; RLS assertions use user JWTs only.
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export const FIXTURE_TAG = "RLSFIX";
export const ORG_SLUG = "regapro";

export function loadEnvFiles() {
  for (const rel of ["apps/web/.env.local", ".env.local"]) {
    const filePath = resolve(root, rel);
    if (!existsSync(filePath)) continue;
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
}

export function requireEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secret =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !secret) {
    throw new Error(
      "Need NEXT_PUBLIC_SUPABASE_URL, publishable/anon key, and SUPABASE_SECRET_KEY for RLS tests.",
    );
  }
  return { url, anon, secret };
}

export function createAdminClient(url, secret) {
  return createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Authenticated client bound to a user access token (RLS as that user). */
export function createUserClient(url, anon, accessToken) {
  return createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
}

export function newRunId() {
  return randomBytes(4).toString("hex");
}

export function fixturePassword() {
  return (
    process.env.RLS_TEST_PASSWORD ||
    `Rls!${randomBytes(12).toString("base64url")}`
  );
}

export function fixtureEmail(runId, roleKey) {
  const domain = process.env.RLS_TEST_EMAIL_DOMAIN || "example.com";
  return `rls.${FIXTURE_TAG.toLowerCase()}.${runId}.${roleKey}@${domain}`;
}

export function tagTitle(runId, label) {
  return `[${FIXTURE_TAG}:${runId}] ${label}`;
}

export function isTaggedTitle(runId, title) {
  return typeof title === "string" && title.startsWith(`[${FIXTURE_TAG}:${runId}]`);
}

export class RlsReporter {
  constructor() {
    this.results = [];
  }

  pass(name, detail = "") {
    this.results.push({ name, status: "PASS", detail });
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  }

  fail(name, detail = "") {
    this.results.push({ name, status: "FAIL", detail });
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }

  /**
   * Positive: expect row(s) visible.
   * @param {{ data: unknown[] | null, error: { message?: string } | null }} result
   * @param {(row: any) => boolean} [match]
   */
  expectRows(name, result, match) {
    if (result.error) {
      this.fail(name, `unexpected error: ${result.error.message}`);
      return false;
    }
    const rows = result.data ?? [];
    const filtered = match ? rows.filter(match) : rows;
    if (filtered.length === 0) {
      this.fail(name, "expected >=1 row, got 0");
      return false;
    }
    this.pass(name, `rows=${filtered.length}`);
    return true;
  }

  /**
   * Negative: must not see specific id (0 rows OR RLS error).
   * Unexpected rows → FAIL.
   */
  expectDenied(name, result, targetId) {
    if (result.error) {
      this.pass(
        name,
        `denied via error (${result.error.message ?? "RLS/PostgREST"})`,
      );
      return true;
    }
    const rows = result.data ?? [];
    const hit = targetId
      ? rows.filter((r) => r.id === targetId)
      : rows;
    if (hit.length > 0) {
      this.fail(
        name,
        `expected deny but got ${hit.length} row(s) id=${hit.map((r) => r.id).join(",")}`,
      );
      return false;
    }
    this.pass(name, "denied via 0 rows");
    return true;
  }

  /** Write that must fail (error or 0 affected). */
  expectWriteDenied(name, result) {
    if (result.error) {
      this.pass(
        name,
        `denied via error (${result.error.message ?? "RLS/PostgREST"})`,
      );
      return true;
    }
    const data = result.data;
    const count = Array.isArray(data) ? data.length : data ? 1 : 0;
    if (count > 0) {
      this.fail(name, `expected write deny but affected ${count} row(s)`);
      return false;
    }
    this.pass(name, "denied via 0 affected rows");
    return true;
  }

  expectWriteOk(name, result) {
    if (result.error) {
      this.fail(name, `unexpected error: ${result.error.message}`);
      return false;
    }
    this.pass(name, "write accepted");
    return true;
  }

  summary() {
    const pass = this.results.filter((r) => r.status === "PASS").length;
    const fail = this.results.filter((r) => r.status === "FAIL").length;
    console.log("\n========== RLS INTEGRATION SUMMARY ==========");
    console.log(`PASS: ${pass}`);
    console.log(`FAIL: ${fail}`);
    console.log(`TOTAL: ${this.results.length}`);
    return { pass, fail, total: this.results.length };
  }
}
