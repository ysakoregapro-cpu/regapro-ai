"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicEnv } from "./env";
import type { Database } from "./types";

/**
 * Browser / Client Component Supabase client (anon / publishable key only).
 * Never import admin.ts or secret keys into client components.
 */
export function createBrowserSupabaseClient() {
  const { url, publishableKey } = getSupabasePublicEnv();
  return createBrowserClient<Database>(url, publishableKey);
}

/** @deprecated Prefer createBrowserSupabaseClient */
export function createClient() {
  return createBrowserSupabaseClient();
}
