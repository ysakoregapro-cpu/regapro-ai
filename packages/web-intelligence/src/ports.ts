import type { ConfidentialityLevel } from "@regapro/shared";
import type {
  ResearchEvidence,
  SanitizedQueryPlan,
  WebIntelligenceBudget,
  WebResearchResult,
  WebSource,
} from "./types.js";

export type WebSearchProvider = {
  readonly id: "tavily" | "exa";
  readonly connected: boolean;
  search(input: {
    query: string;
    limit: number;
    signal?: AbortSignal;
  }): Promise<WebSource[]>;
};

export type WebContentProvider = {
  readonly id: "firecrawl";
  readonly connected: boolean;
  fetchPage(input: {
    url: string;
    signal?: AbortSignal;
  }): Promise<WebSource | null>;
};

export type BrowserProvider = {
  readonly id: "browserbase";
  readonly connected: boolean;
  /**
   * Costly escalation only — JS / interactive pages after search+scrape fail.
   */
  fetchInteractive(input: {
    url: string;
    signal?: AbortSignal;
  }): Promise<WebSource | null>;
};

export type WebResearchProvider = {
  readonly id: string;
  readonly connected: boolean;
  research(input: {
    plan: SanitizedQueryPlan;
    confidentialityLevel: ConfidentialityLevel;
    budget: WebIntelligenceBudget;
    needPageBodies: boolean;
    allowBrowserEscalation: boolean;
  }): Promise<WebResearchResult>;
};

export type WebIntelligenceDeps = {
  search: WebSearchProvider;
  content: WebContentProvider;
  browser: BrowserProvider;
  secondarySearch?: WebSearchProvider;
};
