import "server-only";
import {
  BrowserLocalModelProviderSlot,
  FallbackChainModelProvider,
  VercelGatewayModelProvider,
  WebIntelligenceResearchRetriever,
  WebIntelligenceRetriever,
  type ModelProvider,
  type ResearchRetriever,
  type WebRetriever,
} from "@regapro/ai-runtime";
import { createWebIntelligenceDeps } from "@regapro/web-intelligence";
import { getDataMode } from "@/lib/supabase/env";

function hasKey(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

/** Booleans and selected ids only — never secret values. */
export function cloudRuntimeStatus() {
  const aiGatewayKeyPresent = hasKey("AI_GATEWAY_API_KEY");
  const tavilyKeyPresent = hasKey("TAVILY_API_KEY");
  const firecrawlKeyPresent = hasKey("FIRECRAWL_API_KEY");
  const browserbaseKeyPresent = hasKey("BROWSERBASE_API_KEY");
  const browserbaseProjectIdPresent = hasKey("BROWSERBASE_PROJECT_ID");
  return {
    dataMode: getDataMode(),
    aiGatewayKeyPresent,
    tavilyKeyPresent,
    firecrawlKeyPresent,
    browserbaseKeyPresent,
    browserbaseProjectIdPresent,
    aiGateway: aiGatewayKeyPresent,
    tavily: tavilyKeyPresent,
    firecrawl: firecrawlKeyPresent,
    browserbase: browserbaseKeyPresent && browserbaseProjectIdPresent,
    selectedProvider: aiGatewayKeyPresent ? "vercel-ai-gateway" : "honest-fallback",
    selectedModelRole: "main",
    langfuse:
      hasKey("LANGFUSE_PUBLIC_KEY") &&
      hasKey("LANGFUSE_SECRET_KEY") &&
      hasKey("LANGFUSE_BASE_URL"),
    exa: hasKey("EXA_API_KEY"),
  };
}

export function createCloudModelProviderFromEnv(): ModelProvider {
  const gateway = new VercelGatewayModelProvider();
  const local = new BrowserLocalModelProviderSlot();
  return new FallbackChainModelProvider([gateway, local]);
}

export function createWebRetrieversFromEnv(): {
  web: WebRetriever;
  research: ResearchRetriever;
} {
  const deps = createWebIntelligenceDeps(process.env);
  return {
    web: new WebIntelligenceRetriever(deps),
    research: new WebIntelligenceResearchRetriever(deps),
  };
}
