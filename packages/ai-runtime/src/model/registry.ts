import {
  DEFAULT_MODEL_BY_ROLE,
  MODEL_ROLE_ENV,
  type ModelCatalogEntry,
  type ModelRole,
} from "./roles.js";

const DEFAULT_GATEWAY_BASE = "https://ai-gateway.vercel.sh/v1";

export type ModelCapabilityRegistry = {
  roleModel(role: ModelRole): string;
  lookup(modelId: string): ModelCatalogEntry | null;
  catalogLoaded: boolean;
  catalogError: string | null;
  refresh(): Promise<void>;
};

function envModel(role: ModelRole, env: NodeJS.ProcessEnv): string {
  const key = MODEL_ROLE_ENV[role];
  const override = env[key]?.trim();
  return override || DEFAULT_MODEL_BY_ROLE[role];
}

function parseCatalogEntry(raw: unknown): ModelCatalogEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : null;
  if (!id) return null;
  const caps = Array.isArray(o.capabilities)
    ? o.capabilities.filter((c): c is string => typeof c === "string")
    : [];
  const modalities = Array.isArray(o.modalities)
    ? o.modalities.filter((c): c is string => typeof c === "string")
    : typeof o.architecture === "object" &&
        o.architecture &&
        Array.isArray((o.architecture as { input_modalities?: unknown }).input_modalities)
      ? (
          (o.architecture as { input_modalities: unknown[] }).input_modalities
        ).filter((c): c is string => typeof c === "string")
      : [];
  const pricingRaw =
    o.pricing && typeof o.pricing === "object"
      ? (o.pricing as Record<string, unknown>)
      : {};
  const parseUsd = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim()) {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };
  return {
    id,
    ownedBy: typeof o.owned_by === "string" ? o.owned_by : null,
    capabilities: caps,
    modalities,
    reasoning:
      caps.includes("reasoning") ||
      Boolean(o.reasoning) ||
      /o[134]|reason/i.test(id),
    toolUse:
      caps.includes("tool-use") ||
      caps.includes("function_calling") ||
      Boolean(o.tools),
    contextWindow:
      typeof o.context_window === "number"
        ? o.context_window
        : typeof o.context_length === "number"
          ? o.context_length
          : null,
    pricing: {
      inputPerMillionUsd: parseUsd(pricingRaw.input ?? pricingRaw.prompt),
      outputPerMillionUsd: parseUsd(pricingRaw.output ?? pricingRaw.completion),
    },
  };
}

/**
 * Discovers models from the inference gateway. Missing catalog entries
 * must not crash the application — env/default ids remain usable.
 */
export function createModelCapabilityRegistry(input?: {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  apiKey?: string | null;
  baseUrl?: string;
}): ModelCapabilityRegistry {
  const env = input?.env ?? process.env;
  const fetchImpl = input?.fetchImpl ?? fetch;
  const apiKey = input?.apiKey ?? env.AI_GATEWAY_API_KEY?.trim() ?? null;
  const baseUrl = (input?.baseUrl ?? env.AI_GATEWAY_BASE_URL ?? DEFAULT_GATEWAY_BASE).replace(
    /\/$/,
    "",
  );

  const byRole: Record<ModelRole, string> = {
    fast: envModel("fast", env),
    main: envModel("main", env),
    reasoning: envModel("reasoning", env),
    code: envModel("code", env),
    vision: envModel("vision", env),
  };

  let catalog = new Map<string, ModelCatalogEntry>();
  let catalogLoaded = false;
  let catalogError: string | null = null;

  async function refresh(): Promise<void> {
    if (!apiKey) {
      catalogLoaded = false;
      catalogError = "gateway_unconfigured";
      return;
    }
    try {
      const res = await fetchImpl(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) {
        catalogError = `catalog_http_${res.status}`;
        catalogLoaded = false;
        return;
      }
      const json = (await res.json()) as { data?: unknown[] };
      const next = new Map<string, ModelCatalogEntry>();
      for (const row of json.data ?? []) {
        const entry = parseCatalogEntry(row);
        if (entry) next.set(entry.id, entry);
      }
      catalog = next;
      catalogLoaded = true;
      catalogError = null;
    } catch {
      catalogError = "catalog_unavailable";
      catalogLoaded = false;
    }
  }

  return {
    roleModel(role) {
      return byRole[role];
    },
    lookup(modelId) {
      return catalog.get(modelId) ?? null;
    },
    get catalogLoaded() {
      return catalogLoaded;
    },
    get catalogError() {
      return catalogError;
    },
    refresh,
  };
}

export function estimateCostUsd(input: {
  catalog: ModelCatalogEntry | null;
  promptTokens: number;
  completionTokens: number;
}): { usd: number | null; source: "catalog" | "unknown" } {
  const p = input.catalog?.pricing.inputPerMillionUsd;
  const c = input.catalog?.pricing.outputPerMillionUsd;
  if (p == null || c == null) return { usd: null, source: "unknown" };
  const usd =
    (input.promptTokens / 1_000_000) * p + (input.completionTokens / 1_000_000) * c;
  return { usd, source: "catalog" };
}
