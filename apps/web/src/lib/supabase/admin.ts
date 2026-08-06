import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublicEnv, getSupabaseSecretKey } from "./env";
import type { Database } from "./types";

/**
 * Server-only admin client. Never import from Client Components.
 * Limited to bootstrap, invitations, cron, and maintenance jobs.
 */
export function createAdminClient() {
  const { url } = getSupabasePublicEnv();
  const secretKey = getSupabaseSecretKey();
  return createSupabaseClient<Database>(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
