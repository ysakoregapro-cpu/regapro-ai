import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { AUTH_META, loadE2eEnv } from "./helpers/env";

export default async function globalTeardown() {
  loadE2eEnv();
  if (!existsSync(AUTH_META)) return;
  let meta: { tempUserId?: string | null; created?: boolean } = {};
  try {
    meta = JSON.parse(readFileSync(AUTH_META, "utf8")) as typeof meta;
  } catch {
    return;
  }
  if (!meta.created || !meta.tempUserId) return;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secret = (
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ""
  ).trim();
  if (!url || !secret) return;

  const admin = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const tempUserId = meta.tempUserId;
  const memberships = await admin
    .from("organization_memberships")
    .select("id")
    .eq("user_id", tempUserId);
  await admin.from("membership_roles").delete().in(
    "membership_id",
    memberships.data?.map((r) => r.id) ?? [],
  );
  await admin.from("organization_memberships").delete().eq("user_id", tempUserId);
  await admin.from("profiles").delete().eq("user_id", tempUserId);
  await admin.auth.admin.deleteUser(tempUserId);
}
