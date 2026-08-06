import { z } from "zod";

const dataModeSchema = z.enum(["dev-sample", "supabase"]);

export type RegaproDataMode = z.infer<typeof dataModeSchema>;

export function getDataMode(): RegaproDataMode {
  const raw = process.env.REGAPRO_DATA_MODE;
  if (raw === undefined || raw === "") {
    return "dev-sample";
  }
  const parsed = dataModeSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Invalid REGAPRO_DATA_MODE="${raw}". Expected "dev-sample" or "supabase".`
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

export function getSupabasePublicEnv() {
  return publicEnvSchema.parse({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}

export function getSupabaseSecretKey(): string {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) {
    throw new Error("SUPABASE_SECRET_KEY is not configured (server-only).");
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
