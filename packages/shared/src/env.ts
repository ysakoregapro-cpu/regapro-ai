import { z } from "zod";

export const DataModeSchema = z.enum(["dev-sample", "supabase"]);

export type DataMode = z.infer<typeof DataModeSchema>;

export class RegaproEnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegaproEnvError";
  }
}

export interface RegaproEnv {
  dataMode: DataMode;
}

export function parseDataMode(raw: string | undefined): DataMode {
  const result = DataModeSchema.safeParse(raw);
  if (!result.success) {
    throw new RegaproEnvError(
      `REGAPRO_DATA_MODE must be exactly 'dev-sample' or 'supabase'. Received: ${JSON.stringify(raw ?? null)}`,
    );
  }
  return result.data;
}

export function loadRegaproEnv(
  env: Record<string, string | undefined> = process.env,
): RegaproEnv {
  const dataMode = parseDataMode(env.REGAPRO_DATA_MODE);
  return { dataMode };
}
