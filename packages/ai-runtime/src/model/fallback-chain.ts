import type { ModelGenerateInput, ModelGenerateOutput, ModelProvider } from "../ports.js";
import { RuntimeBudgetGuard } from "./budget.js";
import { ContextGroundedModelProvider } from "./context-grounded.js";
import { HonestFallbackModelProvider } from "./honest-fallback.js";
import { CapabilityModelRouter, fallbackRoles, type ModelRouter } from "./router.js";

/**
 * primary cloud model → secondary role → alternate provider → optional local → HonestFallback
 */
export class FallbackChainModelProvider implements ModelProvider {
  readonly id: ModelProvider["id"];
  readonly connected: boolean;

  constructor(
    private readonly providers: ModelProvider[],
    private readonly router: ModelRouter = new CapabilityModelRouter(),
    private readonly grounded: ModelProvider = new ContextGroundedModelProvider(),
    private readonly honest: ModelProvider = new HonestFallbackModelProvider(),
  ) {
    const live = providers.find((p) => p.connected);
    this.id = live?.id ?? "honest-fallback";
    this.connected = Boolean(live);
  }

  async generate(input: ModelGenerateInput): Promise<ModelGenerateOutput> {
    const route = this.router.route({
      intent: input.intent.intent,
      text: input.userText,
      hasInternalEvidence: input.context.items.some(
        (i) => i.sourceType === "knowledge" || i.sourceType === "knowledge_chunk",
      ),
      hasWebEvidence: input.context.items.some(
        (i) => i.sourceType === "web" || i.sourceType === "research",
      ),
    });

    if (route.skipLlm) {
      const grounded = await this.grounded.generate({ ...input, role: null });
      return { ...grounded, role: null, fallbackCount: 0 };
    }

    const budget = new RuntimeBudgetGuard();
    const roles = fallbackRoles(route);
    let fallbackCount = 0;
    let lastError: string | null = null;

    for (const role of roles) {
      for (const provider of this.providers) {
        if (!provider.connected) continue;
        if (!budget.takeLlmCall()) break;
        try {
          const out = await provider.generate({ ...input, role });
          return { ...out, role: out.role ?? role, fallbackCount };
        } catch (err) {
          fallbackCount += 1;
          lastError = err instanceof Error ? err.message : "MODEL_FAILED";
        }
      }
    }

    const local = this.providers.find((p) => p.id === "browser-local" && p.connected);
    if (local && budget.takeLlmCall()) {
      try {
        const out = await local.generate({ ...input, role: route.role });
        return { ...out, fallbackCount: fallbackCount + 1 };
      } catch {
        fallbackCount += 1;
      }
    }

    const honest = await this.honest.generate(input);
    const extra = lastError
      ? [`クラウド推論に失敗したため、未接続時と同じ案内に切り替えました。`]
      : [];
    return {
      ...honest,
      fallbackCount,
      limitations: [...honest.limitations, ...extra],
      role: route.role,
    };
  }
}

export function createCloudModelProvider(input: {
  gateway: ModelProvider;
  local?: ModelProvider | null;
  selfHosted?: ModelProvider | null;
}): ModelProvider {
  const providers: ModelProvider[] = [input.gateway];
  if (input.selfHosted) providers.push(input.selfHosted);
  if (input.local) providers.push(input.local);
  return new FallbackChainModelProvider(providers);
}
