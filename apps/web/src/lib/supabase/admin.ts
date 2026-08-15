import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublicEnv, getSupabaseSecretKey } from "./env";
import type { Database } from "./types";

/**
 * Server-only admin client (service role). Bypasses RLS.
 * Never import from Client Components or expose to the browser bundle.
 * Use only for bootstrap, invitations, workers, and maintenance.
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
