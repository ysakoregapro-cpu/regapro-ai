import { z } from "zod";

export const ModelCapabilitySchema = z.enum([
  "intent",
  "query_gen",
  "entity_extraction",
  "short_answer",
  "style",
  "prompt_gen",
]);

export type ModelCapability = z.infer<typeof ModelCapabilitySchema>;

export const ModelManifestEntrySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  provider: z.string().min(1),
  capabilities: z.array(ModelCapabilitySchema),
  webGpuRequired: z.boolean().default(false),
});

export type ModelManifestEntry = z.infer<typeof ModelManifestEntrySchema>;

export const DEFAULT_MODEL_MANIFEST: ModelManifestEntry[] = [
  {
    id: "rule-based-intent",
    label: "Rule-based Intent",
    provider: "regapro",
    capabilities: ["intent", "entity_extraction"],
    webGpuRequired: false,
  },
  {
    id: "template-language",
    label: "Template Language",
    provider: "regapro",
    capabilities: ["short_answer", "style", "prompt_gen"],
    webGpuRequired: false,
  },
  {
    id: "browser-local-stub",
    label: "Browser Local LLM (stub)",
    provider: "browser",
    capabilities: ["short_answer", "query_gen"],
    webGpuRequired: true,
  },
];

export interface LanguageModelRequest {
  prompt: string;
  capability: ModelCapability;
  context?: Record<string, string>;
}

export interface LanguageModelResponse {
  text: string;
  confidence: number;
  provider: string;
  modelId: string;
}

export interface LanguageModelProvider {
  readonly id: string;
  readonly capabilities: readonly ModelCapability[];
  generate(request: LanguageModelRequest): Promise<LanguageModelResponse>;
}

export function detectWebGpuSupport(): boolean {
  const nav = (globalThis as { navigator?: { gpu?: unknown } }).navigator;
  if (!nav) return false;
  return nav.gpu !== undefined;
}

export class BrowserLocalLLMProvider implements LanguageModelProvider {
  readonly id = "browser-local-stub";
  readonly capabilities = ["short_answer", "query_gen"] as const;

  async generate(request: LanguageModelRequest): Promise<LanguageModelResponse> {
    const webGpu = detectWebGpuSupport();
    return {
      text: webGpu
        ? `[stub local LLM] ${request.prompt.slice(0, 120)}`
        : "[stub local LLM unavailable: WebGPU not detected]",
      confidence: webGpu ? 0.3 : 0,
      provider: this.id,
      modelId: "browser-local-stub",
    };
  }
}

export class RuleBasedIntentProvider implements LanguageModelProvider {
  readonly id = "rule-based-intent";
  readonly capabilities = ["intent", "entity_extraction"] as const;

  async generate(request: LanguageModelRequest): Promise<LanguageModelResponse> {
    const lower = request.prompt.toLowerCase();
    let intent = "general";
    if (/task|todo|タスク/.test(lower)) intent = "create_task";
    else if (/search|検索|調査/.test(lower)) intent = "research";
    else if (/knowledge|ナレッジ|資料/.test(lower)) intent = "knowledge";
    return {
      text: JSON.stringify({ intent, entities: [] }),
      confidence: 0.75,
      provider: this.id,
      modelId: "rule-based-intent",
    };
  }
}

export class TemplateLanguageProvider implements LanguageModelProvider {
  readonly id = "template-language";
  readonly capabilities = ["short_answer", "style", "prompt_gen"] as const;

  async generate(request: LanguageModelRequest): Promise<LanguageModelResponse> {
    return {
      text: `Template response for: ${request.prompt.slice(0, 200)}`,
      confidence: 0.6,
      provider: this.id,
      modelId: "template-language",
    };
  }
}

export class OpenAIProviderStub implements LanguageModelProvider {
  readonly id = "openai-stub";
  readonly capabilities = ["short_answer"] as const;

  async generate(_request: LanguageModelRequest): Promise<LanguageModelResponse> {
    throw new Error("OpenAI provider is not connected");
  }
}

export class GeminiProviderStub implements LanguageModelProvider {
  readonly id = "gemini-stub";
  readonly capabilities = ["short_answer"] as const;

  async generate(_request: LanguageModelRequest): Promise<LanguageModelResponse> {
    throw new Error("Gemini provider is not connected");
  }
}

export class ClaudeProviderStub implements LanguageModelProvider {
  readonly id = "claude-stub";
  readonly capabilities = ["short_answer"] as const;

  async generate(_request: LanguageModelRequest): Promise<LanguageModelResponse> {
    throw new Error("Claude provider is not connected");
  }
}

export function getProviderForCapability(
  capability: ModelCapability,
): LanguageModelProvider[] {
  const providers: LanguageModelProvider[] = [
    new RuleBasedIntentProvider(),
    new TemplateLanguageProvider(),
    new BrowserLocalLLMProvider(),
  ];
  return providers.filter((p) => p.capabilities.includes(capability));
}

export * from "./embedding-manifest.js";
export {
  TransformersJsEmbeddingProvider,
  resolveEmbeddingRuntimeMode,
  type EmbeddingRuntimeMode,
} from "./transformers-embedding.js";
export { createEmbeddingProvider } from "./embedding-factory.js";
