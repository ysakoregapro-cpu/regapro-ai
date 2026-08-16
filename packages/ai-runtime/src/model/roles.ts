export type ModelRole = "fast" | "main" | "reasoning" | "code" | "vision";

export const MODEL_ROLES: readonly ModelRole[] = [
  "fast",
  "main",
  "reasoning",
  "code",
  "vision",
] as const;

export const DEFAULT_MODEL_BY_ROLE: Record<ModelRole, string> = {
  fast: "openai/gpt-4.1-mini",
  main: "openai/gpt-4.1",
  reasoning: "openai/o4-mini",
  code: "openai/gpt-4.1",
  vision: "openai/gpt-4.1",
};

export const MODEL_ROLE_ENV: Record<ModelRole, string> = {
  fast: "REGAPRO_MODEL_FAST",
  main: "REGAPRO_MODEL_MAIN",
  reasoning: "REGAPRO_MODEL_REASONING",
  code: "REGAPRO_MODEL_CODE",
  vision: "REGAPRO_MODEL_VISION",
};

export type ModelCatalogEntry = {
  id: string;
  ownedBy: string | null;
  capabilities: string[];
  modalities: string[];
  reasoning: boolean;
  toolUse: boolean;
  contextWindow: number | null;
  pricing: {
    inputPerMillionUsd: number | null;
    outputPerMillionUsd: number | null;
  };
};

export type ModelUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type EstimatedCost = {
  usd: number | null;
  currency: "USD";
  source: "catalog" | "heuristic" | "unknown";
};
