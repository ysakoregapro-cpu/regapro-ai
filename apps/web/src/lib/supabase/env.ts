import { z } from "zod";

const dataModeSchema = z.enum(["dev-sample", "supabase"]);

export type RegaproDataMode = z.infer<typeof dataModeSchema>;

export function getDataMode(): RegaproDataMode {
  // Client components may read NEXT_PUBLIC_*; server prefers REGAPRO_DATA_MODE.
  // Next.js loads apps/web/.env.local into this process when `next dev`/`next build` runs.
  const raw =
    process.env.REGAPRO_DATA_MODE ||
    process.env.NEXT_PUBLIC_REGAPRO_DATA_MODE;
  if (raw === undefined || raw === "") {
    const hasLiveSupabase = Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
        (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()),
    );
    // Placeholder/dev-sample is opt-in. Localhost with live Supabase config
    // must not silently select HonestFallback / demo research.
    return hasLiveSupabase ? "supabase" : "dev-sample";
  }
  const parsed = dataModeSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Invalid REGAPRO_DATA_MODE="${raw}". Expected "dev-sample" or "supabase".`,
    );
  }
  return parsed.data;
}

export function isDevSampleMode(): boolean {
  return getDataMode() === "dev-sample";
}

export function isSupabaseMode(): boolean {
  return getDataMode() === "supabase";
}

const publicEnvSchema = z.object({
  url: z.string().url(),
  publishableKey: z.string().min(1),
});

/** Prefer publishable key; accept legacy anon key name for ops docs compatibility. */
function resolvePublishableKey(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

/** Prefer secret key; accept legacy service_role name for ops docs compatibility. */
function resolveSecretKey(): string | undefined {
  return process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
}

export function getSupabasePublicEnv() {
  return publicEnvSchema.parse({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: resolvePublishableKey(),
  });
}

export function getSupabaseSecretKey(): string {
  const key = resolveSecretKey();
  if (!key) {
    throw new Error(
      "SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) is not configured (server-only).",
    );
  }
  return key;
}

export function hasSupabasePublicConfig(): boolean {
  try {
    getSupabasePublicEnv();
    return true;
  } catch {
    return false;
  }
}

export function hasSupabaseAdminConfig(): boolean {
  try {
    getSupabasePublicEnv();
    getSupabaseSecretKey();
    return true;
  } catch {
    return false;
  }
}
