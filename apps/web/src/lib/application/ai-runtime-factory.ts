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

function hasKey(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

export function cloudRuntimeStatus() {
  return {
    aiGateway: hasKey("AI_GATEWAY_API_KEY"),
    tavily: hasKey("TAVILY_API_KEY"),
    firecrawl: hasKey("FIRECRAWL_API_KEY"),
    browserbase: hasKey("BROWSERBASE_API_KEY") && hasKey("BROWSERBASE_PROJECT_ID"),
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
