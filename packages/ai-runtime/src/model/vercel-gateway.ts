import type { ModelGenerateInput, ModelGenerateOutput, ModelProvider } from "../ports.js";
import { healthFor } from "./circuit-breaker.js";
import { recordProcessUsage } from "./budget.js";
import {
  createModelCapabilityRegistry,
  estimateCostUsd,
  type ModelCapabilityRegistry,
} from "./registry.js";
import type { ModelRole } from "./roles.js";
import {
  filterOutboundLlmPayload,
  gatewayProviderOptions,
} from "./security-filter.js";

const DEFAULT_GATEWAY_BASE = "https://ai-gateway.vercel.sh/v1";

type ChatChoice = {
  message?: { content?: string | null };
};

type ChatResponse = {
  id?: string;
  model?: string;
  choices?: ChatChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

function allowlistFromEnv(env: NodeJS.ProcessEnv): string[] {
  const raw = env.REGAPRO_GATEWAY_PROVIDER_ALLOWLIST?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function postChat(input: {
  fetchImpl: typeof fetch;
  url: string;
  apiKey: string;
  body: unknown;
  timeoutMs: number;
}): Promise<ChatResponse> {
  const res = await input.fetchImpl(input.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input.body),
    signal: AbortSignal.timeout(input.timeoutMs),
  });
  if (!res.ok) {
    const err = new Error(`GATEWAY_HTTP_${res.status}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return (await res.json()) as ChatResponse;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number,
): Promise<T> {
  let last: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const status = (err as { status?: number }).status;
      if (status && status < 500 && status !== 429) throw err;
      if (i === retries) break;
      await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
  throw last instanceof Error ? last : new Error("GATEWAY_RETRY_EXHAUSTED");
}

/**
 * Cloud inference engine behind ModelProvider.
 * Vercel AI Gateway is not RegaloProfessional AI — it is a swappable LLM route.
 */
export class VercelGatewayModelProvider implements ModelProvider {
  readonly id = "vercel-gateway" as const;
  readonly connected: boolean;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly registry: ModelCapabilityRegistry;
  private readonly allowlist: string[];

  constructor(opts?: {
    apiKey?: string | null;
    baseUrl?: string;
    fetchImpl?: typeof fetch;
    env?: NodeJS.ProcessEnv;
    registry?: ModelCapabilityRegistry;
  }) {
    const env = opts?.env ?? process.env;
    const key = opts?.apiKey ?? env.AI_GATEWAY_API_KEY?.trim() ?? "";
    this.apiKey = key;
    this.connected = Boolean(key);
    this.baseUrl = (opts?.baseUrl ?? env.AI_GATEWAY_BASE_URL ?? DEFAULT_GATEWAY_BASE).replace(
      /\/$/,
      "",
    );
    this.fetchImpl = opts?.fetchImpl ?? fetch;
    this.registry =
      opts?.registry ??
      createModelCapabilityRegistry({
        env,
        fetchImpl: this.fetchImpl,
        apiKey: key || null,
        baseUrl: this.baseUrl,
      });
    this.allowlist = allowlistFromEnv(env);
  }

  async generate(input: ModelGenerateInput): Promise<ModelGenerateOutput> {
    if (!this.connected) {
      throw new Error("GATEWAY_UNCONFIGURED");
    }
    const health = healthFor(this.id);
    if (!health.isAvailable()) {
      throw new Error("GATEWAY_CIRCUIT_OPEN");
    }

    const payload = filterOutboundLlmPayload({
      access: input.access,
      userText: input.userText,
      context: input.context,
      task: input.task,
      systemOverride: input.systemOverride,
    });
    const role: ModelRole = input.role ?? "main";
    const modelId = this.registry.roleModel(role);
    const catalog = this.registry.lookup(modelId);
    const providerOptions = gatewayProviderOptions({
      zeroDataRetention: payload.zeroDataRetention,
      disallowPromptTraining: payload.disallowPromptTraining,
      allowlist: this.allowlist,
    });

    try {
      const json = await withRetry(
        () =>
          postChat({
            fetchImpl: this.fetchImpl,
            url: `${this.baseUrl}/chat/completions`,
            apiKey: this.apiKey,
            timeoutMs: 25_000,
            body: {
              model: modelId,
              messages: [
                { role: "system", content: payload.system },
                { role: "user", content: payload.user },
              ],
              temperature: role === "reasoning" ? 0.2 : 0.3,
              ...(Object.keys(providerOptions).length
                ? { providerOptions }
                : {}),
            },
          }),
        2,
      );
      const text = json.choices?.[0]?.message?.content?.trim() ?? "";
      if (!text) throw new Error("GATEWAY_EMPTY_COMPLETION");
      const usage = {
        promptTokens: json.usage?.prompt_tokens ?? 0,
        completionTokens: json.usage?.completion_tokens ?? 0,
        totalTokens:
          json.usage?.total_tokens ??
          (json.usage?.prompt_tokens ?? 0) + (json.usage?.completion_tokens ?? 0),
      };
      const cost = estimateCostUsd({
        catalog,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
      });
      health.recordSuccess();
      recordProcessUsage({
        llmCalls: 1,
        tokens: usage.totalTokens,
        estimatedCostUsd: cost.usd,
      });
      return {
        text,
        confidence: 0.75,
        providerId: this.id,
        modelId: json.model ?? modelId,
        connected: true,
        limitations: catalog ? [] : ["モデルカタログ未取得のため既定IDを使用しました。"],
        role,
        fallbackCount: 0,
        usage,
        estimatedCostUsd: cost.usd,
      };
    } catch (err) {
      health.recordFailure();
      recordProcessUsage({ llmCalls: 1, failed: true });
      throw err;
    }
  }
}

/** Future self-hosted replacement for ExternalModelProvider. */
export class SelfHostedModelProviderSlot implements ModelProvider {
  readonly id = "self-hosted" as const;
  readonly connected: boolean;
  constructor(baseUrl?: string | null) {
    this.connected = Boolean(baseUrl?.trim());
  }
  async generate(): Promise<ModelGenerateOutput> {
    return {
      text: "自社モデル実行基盤はまだ接続されていません。",
      confidence: 0,
      providerId: this.id,
      modelId: "self-hosted-unconnected",
      connected: false,
      limitations: ["SelfHostedModelProvider は未接続です。"],
    };
  }
}
