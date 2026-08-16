import type { AccessContext } from "@regapro/security";
import {
  assertNoSensitiveInExternalQueries,
  DefaultWebResearchProvider,
  sanitizeExternalQuery,
  type WebIntelligenceBudget,
  type WebIntelligenceDeps,
  type WebResearchResult,
  DEFAULT_WEB_BUDGET,
} from "@regapro/web-intelligence";
import type { ResearchRetriever, WebRetriever } from "../ports.js";
import type { RetrievedItem, RetrievalPlan } from "../types.js";

export type WebRunStats = {
  sanitizedQueryCount: number;
  pagesFetched: number;
  sourceCount: number;
};

const EMPTY_STATS: WebRunStats = {
  sanitizedQueryCount: 0,
  pagesFetched: 0,
  sourceCount: 0,
};

function toItems(
  result: WebResearchResult,
  sourceType: "web" | "research",
): RetrievedItem[] {
  return result.sources.map((s) => ({
    id: sourceType === "research" ? `research-${s.id}` : s.id,
    title: s.title,
    content: (s.extractedText ?? s.snippet).slice(0, 4000),
    sourceType,
    sourceId: s.id,
    sourceUri: s.canonicalUrl,
    confidentialityLevel: "company" as const,
    visibility: "organization" as const,
    relevance: s.relevance,
    freshness: s.publishedAt ?? s.retrievedAt,
    excerpt: (s.citation.excerpt || s.snippet).slice(0, 240),
    domain: s.domain,
    publishedAt: s.publishedAt,
    retrievedAt: s.retrievedAt,
  }));
}

function runResearch(
  deps: WebIntelligenceDeps,
  input: {
    access: AccessContext;
    plan: RetrievalPlan;
    query: string;
    needPageBodies: boolean;
    allowBrowserEscalation: boolean;
    budget?: WebIntelligenceBudget;
  },
): Promise<WebResearchResult> {
  if (!input.access?.userId) throw new Error("ACCESS_CONTEXT_REQUIRED");
  const sanitized = sanitizeExternalQuery({
    request: input.query,
    confidentialityLevel: input.access.threadConfidentialityLevel,
  });
  assertNoSensitiveInExternalQueries(sanitized);
  const provider = new DefaultWebResearchProvider(deps);
  return provider.research({
    plan: sanitized,
    confidentialityLevel: input.access.threadConfidentialityLevel,
    budget: input.budget ?? DEFAULT_WEB_BUDGET,
    needPageBodies: input.needPageBodies,
    allowBrowserEscalation: input.allowBrowserEscalation,
  });
}

function statsFrom(result: WebResearchResult): WebRunStats {
  return {
    sanitizedQueryCount: result.queriesUsed.length,
    pagesFetched: result.pagesFetched,
    sourceCount: result.sources.length,
  };
}

export class WebIntelligenceRetriever implements WebRetriever {
  readonly id = "web-intelligence";
  readonly connected: boolean;
  private lastStats: WebRunStats = EMPTY_STATS;

  constructor(private readonly deps: WebIntelligenceDeps) {
    this.connected = deps.search.connected;
  }

  getLastStats(): WebRunStats {
    return this.lastStats;
  }

  async retrieve(input: {
    access: AccessContext;
    plan: RetrievalPlan;
    query: string;
  }): Promise<RetrievedItem[]> {
    if (!input.plan.needWeb) return [];
    try {
      const result = await runResearch(this.deps, {
        ...input,
        needPageBodies: input.plan.needDeepResearch,
        allowBrowserEscalation: false,
      });
      this.lastStats = statsFrom(result);
      return toItems(result, "web");
    } catch {
      this.lastStats = EMPTY_STATS;
      return [];
    }
  }
}

export class WebIntelligenceResearchRetriever implements ResearchRetriever {
  readonly id = "web-intelligence-research";
  readonly connected: boolean;
  private lastStats: WebRunStats = EMPTY_STATS;

  constructor(private readonly deps: WebIntelligenceDeps) {
    this.connected = deps.search.connected;
  }

  getLastStats(): WebRunStats {
    return this.lastStats;
  }

  async retrieve(input: {
    access: AccessContext;
    plan: RetrievalPlan;
    query: string;
  }): Promise<RetrievedItem[]> {
    if (!input.plan.needDeepResearch) return [];
    try {
      const result = await runResearch(this.deps, {
        ...input,
        needPageBodies: true,
        allowBrowserEscalation: true,
        budget: {
          ...DEFAULT_WEB_BUDGET,
          maxQueries: 4,
          maxFetchedPages: 4,
          maxBrowserSessions: 1,
        },
      });
      this.lastStats = statsFrom(result);
      return toItems(result, "research");
    } catch {
      this.lastStats = EMPTY_STATS;
      return [];
    }
  }
}

export function readRetrieverStats(retriever: unknown): WebRunStats {
  if (
    retriever &&
    typeof retriever === "object" &&
    "getLastStats" in retriever &&
    typeof retriever.getLastStats === "function"
  ) {
    return (retriever.getLastStats as () => WebRunStats)();
  }
  return EMPTY_STATS;
}
