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

function toItems(result: WebResearchResult): RetrievedItem[] {
  return result.sources.map((s) => ({
    id: s.id,
    title: s.title,
    content: (s.extractedText ?? s.snippet).slice(0, 4000),
    sourceType: "web" as const,
    sourceId: s.id,
    sourceUri: s.canonicalUrl,
    confidentialityLevel: "company",
    visibility: "organization" as const,
    relevance: s.relevance,
    freshness: s.publishedAt ?? s.retrievedAt,
    excerpt: (s.citation.excerpt || s.snippet).slice(0, 240),
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

export class WebIntelligenceRetriever implements WebRetriever {
  readonly id = "web-intelligence";
  readonly connected: boolean;

  constructor(private readonly deps: WebIntelligenceDeps) {
    this.connected = deps.search.connected;
  }

  async retrieve(input: {
    access: AccessContext;
    plan: RetrievalPlan;
    query: string;
  }): Promise<RetrievedItem[]> {
    if (!input.plan.needWeb) return [];
    const result = await runResearch(this.deps, {
      ...input,
      needPageBodies: false,
      allowBrowserEscalation: false,
    });
    return toItems(result);
  }
}

export class WebIntelligenceResearchRetriever implements ResearchRetriever {
  readonly id = "web-intelligence-research";
  readonly connected: boolean;

  constructor(private readonly deps: WebIntelligenceDeps) {
    this.connected = deps.search.connected;
  }

  async retrieve(input: {
    access: AccessContext;
    plan: RetrievalPlan;
    query: string;
  }): Promise<RetrievedItem[]> {
    if (!input.plan.needDeepResearch) return [];
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
    return result.sources.map((s) => ({
      id: `research-${s.id}`,
      title: s.title,
      content: (s.extractedText ?? s.snippet).slice(0, 4000),
      sourceType: "research" as const,
      sourceId: s.id,
      sourceUri: s.canonicalUrl,
      confidentialityLevel: "company" as const,
      visibility: "organization" as const,
      relevance: s.relevance,
      freshness: s.publishedAt ?? s.retrievedAt,
      excerpt: (s.citation.excerpt || s.snippet).slice(0, 240),
    }));
  }
}
