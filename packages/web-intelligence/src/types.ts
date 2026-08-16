import type { ConfidentialityLevel } from "@regapro/shared";

export type WebProviderId = "tavily" | "firecrawl" | "browserbase" | "exa";

export type WebSource = {
  id: string;
  title: string;
  url: string;
  canonicalUrl: string;
  domain: string;
  publishedAt: string | null;
  retrievedAt: string;
  snippet: string;
  extractedText: string | null;
  relevance: number;
  freshness: number;
  sourceQuality: number;
  provider: WebProviderId;
  citation: {
    title: string;
    url: string;
    excerpt: string;
  };
};

export type ResearchEvidence = {
  id: string;
  claim: string;
  sources: WebSource[];
  confidence: number;
  groupedTopic: string;
};

export type SanitizedQueryPlan = {
  originalRequest: string;
  sanitizedQueries: string[];
  removedSensitiveSignals: string[];
  requiresConfirmation: boolean;
  confidentialityLevel: ConfidentialityLevel;
  externalTransmissionAllowed: boolean;
};

export type WebIntelligenceBudget = {
  maxQueries: number;
  maxResults: number;
  maxFetchedPages: number;
  maxBrowserSessions: number;
  maxContextChars: number;
  timeoutMs: number;
};

export type WebResearchResult = {
  sources: WebSource[];
  evidence: ResearchEvidence[];
  queriesUsed: string[];
  pagesFetched: number;
  browserSessions: number;
  providerPath: WebProviderId[];
  limitations: string[];
};

export const DEFAULT_WEB_BUDGET: WebIntelligenceBudget = {
  maxQueries: 4,
  maxResults: 8,
  maxFetchedPages: 4,
  maxBrowserSessions: 1,
  maxContextChars: 24_000,
  timeoutMs: 25_000,
};
