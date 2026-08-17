import { mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { request as playwrightRequest } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { AUTH_DIR, AUTH_FILE, AUTH_META, BASE_URL, loadE2eEnv } from "./helpers/env";

/**
 * Logs in once and stores cookies. Creates a temporary L1 editor when
 * REGAPRO_E2E_EMAIL is unset. Never writes secret values to stdout.
 */
export default async function globalSetup() {
  loadE2eEnv();
  mkdirSync(AUTH_DIR, { recursive: true });

  let email = process.env.REGAPRO_E2E_EMAIL?.trim() || "";
  let password = process.env.REGAPRO_E2E_PASSWORD ?? "";
  let tempUserId: string | null = null;

  if (!email || !password) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const secret = (
      process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      ""
    ).trim();
    if (!url || !secret) {
      throw new Error("E2E auth env missing (set REGAPRO_E2E_EMAIL or live Supabase keys)");
    }
    const admin = createClient(url, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: org } = await admin
      .from("organizations")
      .select("id")
      .eq("slug", "regapro")
      .maybeSingle();
    if (!org) throw new Error("E2E org not found");
    const { data: dept } = await admin
      .from("departments")
      .select("id")
      .eq("org_id", org.id)
      .eq("key", "sales")
      .maybeSingle();
    const { data: role } = await admin
      .from("roles")
      .select("id")
      .eq("key", "editor")
      .is("org_id", null)
      .maybeSingle();
    if (!dept?.id || !role?.id) throw new Error("E2E sales/editor fixture missing");

    email = `e2e.pw.${randomBytes(4).toString("hex")}@example.com`;
    password = `E2e!${randomBytes(12).toString("base64url")}`;
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: "E2E Playwright" },
    });
    if (created.error || !created.data.user) {
      throw new Error("E2E temp user create failed");
    }
    tempUserId = created.data.user.id;
    await admin.from("profiles").upsert({
      user_id: tempUserId,
      display_name: "E2E Playwright",
    });
    const { data: mem, error: memErr } = await admin
      .from("organization_memberships")
      .insert({
        org_id: org.id,
        user_id: tempUserId,
        department_id: dept.id,
      })
      .select("id")
      .single();
    if (memErr || !mem) {
      await admin.auth.admin.deleteUser(tempUserId);
      throw new Error("E2E temp membership failed");
    }
    const { error: roleErr } = await admin.from("membership_roles").insert({
      membership_id: mem.id,
      role_id: role.id,
    });
    if (roleErr) {
      await admin.auth.admin.deleteUser(tempUserId);
      throw new Error("E2E temp role failed");
    }
  }

  const context = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const login = await context.post("/api/auth/login", {
    data: { email, password },
    headers: { "Content-Type": "application/json" },
  });
  if (!login.ok()) {
    if (tempUserId) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
      const secret = (
        process.env.SUPABASE_SECRET_KEY ||
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        ""
      ).trim();
      if (url && secret) {
        const admin = createClient(url, secret, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        await admin.auth.admin.deleteUser(tempUserId);
      }
    }
    throw new Error(`E2E login failed status=${login.status()}`);
  }
  await context.storageState({ path: AUTH_FILE });
  await context.dispose();

  writeFileSync(
    AUTH_META,
    JSON.stringify({ tempUserId, created: Boolean(tempUserId) }),
    "utf8",
  );
}
