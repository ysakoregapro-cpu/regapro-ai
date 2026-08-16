import type { WebIntelligenceDeps } from "./ports.js";
import {
  BrowserbaseProvider,
  DisconnectedBrowserProvider,
} from "./providers/browserbase.js";
import {
  DisconnectedContentProvider,
  FirecrawlContentProvider,
} from "./providers/firecrawl.js";
import { ExaSearchProvider } from "./providers/exa.js";
import {
  DisconnectedSearchProvider,
  TavilySearchProvider,
} from "./providers/tavily.js";

function secret(env: NodeJS.ProcessEnv, key: string): string | null {
  const v = env[key]?.trim();
  return v ? v : null;
}

export function createWebIntelligenceDeps(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): WebIntelligenceDeps {
  const tavilyKey = secret(env, "TAVILY_API_KEY");
  const firecrawlKey = secret(env, "FIRECRAWL_API_KEY");
  const browserKey = secret(env, "BROWSERBASE_API_KEY");
  const browserProject = secret(env, "BROWSERBASE_PROJECT_ID");
  const exaKey = secret(env, "EXA_API_KEY");

  return {
    search: tavilyKey
      ? new TavilySearchProvider(tavilyKey, fetchImpl)
      : new DisconnectedSearchProvider("tavily"),
    content: firecrawlKey
      ? new FirecrawlContentProvider(firecrawlKey, fetchImpl)
      : new DisconnectedContentProvider(),
    browser:
      browserKey && browserProject
        ? new BrowserbaseProvider(browserKey, browserProject, fetchImpl)
        : new DisconnectedBrowserProvider(),
    secondarySearch: new ExaSearchProvider(exaKey),
  };
}

export function webProviderStatus(deps: WebIntelligenceDeps) {
  return {
    tavily: deps.search.connected,
    firecrawl: deps.content.connected,
    browserbase: deps.browser.connected,
    exa: deps.secondarySearch?.connected ?? false,
  };
}
