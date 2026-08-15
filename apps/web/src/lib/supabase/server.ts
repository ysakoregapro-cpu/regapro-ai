import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabasePublicEnv } from "./env";
import type { Database } from "./types";

/**
 * Server Component / Route Handler client with cookie-based session restore.
 * Uses the publishable (anon) key — RLS applies as the signed-in user.
 */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();
  const { url, publishableKey } = getSupabasePublicEnv();

  return createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(
        cookiesToSet: { name: string; value: string; options?: CookieOptions }[],
      ) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Called from a Server Component where cookies are read-only.
        }
      },
    },
  });
}

/** @deprecated Prefer createServerSupabaseClient */
export async function createClient() {
  return createServerSupabaseClient();
}
