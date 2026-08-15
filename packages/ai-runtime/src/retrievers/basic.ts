import type { AccessContext } from "@regapro/security";
import { filterResourcesByAccess, effectiveSearchCeiling } from "@regapro/security";
import {
  isConfidentialityAtMost,
  type ConfidentialityLevel,
  type Visibility,
} from "@regapro/shared";
import type {
  InternalKnowledgeRetriever,
  ResearchRetriever,
  WebRetriever,
} from "../ports.js";
import type { RetrievedItem, RetrievalPlan } from "../types.js";

export type KnowledgeCandidate = {
  id: string;
  title: string;
  body: string;
  confidentialityLevel: ConfidentialityLevel;
  visibility: Visibility;
  ownerUserId: string;
  projectId?: string | null;
  departmentId?: string | null;
  published: boolean;
  updatedAt?: string | null;
};

/**
 * Basic internal knowledge retriever.
 * Caller supplies a loader that MUST already be scoped to org;
 * AccessContext filters are applied here (never fetch-all-then-mask).
 * pgvector hybrid search plugs in behind the same interface later.
 */
export class BasicInternalKnowledgeRetriever implements InternalKnowledgeRetriever {
  readonly id = "internal-knowledge-basic";

  constructor(
    private readonly loadCandidates: (input: {
      access: AccessContext;
      query: string;
    }) => Promise<KnowledgeCandidate[]>,
  ) {}

  async retrieve(input: {
    access: AccessContext;
    plan: RetrievalPlan;
    query: string;
  }): Promise<RetrievedItem[]> {
    if (!input.access?.userId || !input.access.organizationId) {
      throw new Error("ACCESS_CONTEXT_REQUIRED");
    }
    if (input.access.auditMode || input.plan.includeAuditCases) {
      // Never mix conversation:audit into normal AI answers.
      return [];
    }
    if (!input.plan.needInternalKnowledge) return [];

    const ceiling = effectiveSearchCeiling(input.access);
    const raw = await this.loadCandidates({
      access: input.access,
      query: input.query,
    });

    // Exclude unpublished / private conversation-shaped knowledge.
    const published = raw.filter((r) => r.published && r.visibility !== "private");

    const filtered = filterResourcesByAccess(input.access, published).filter(
      (r) => isConfidentialityAtMost(r.confidentialityLevel, ceiling),
    );

    const q = input.query.toLowerCase();
    return filtered
      .map((r) => {
        const hay = `${r.title}\n${r.body}`.toLowerCase();
        const relevance = q
          .split(/\s+/)
          .filter(Boolean)
          .reduce((score, term) => score + (hay.includes(term) ? 0.2 : 0), 0.1);
        return {
          id: r.id,
          title: r.title,
          content: r.body.slice(0, 2000),
          sourceType: "knowledge" as const,
          sourceId: r.id,
          sourceUri: null,
          confidentialityLevel: r.confidentialityLevel,
          visibility: r.visibility,
          ownerUserId: r.ownerUserId,
          relevance: Math.min(1, relevance),
          freshness: r.updatedAt ?? null,
          excerpt: r.body.slice(0, 200),
        };
      })
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 20);
  }
}

/** Explicit unconnected WebRetriever — never fabricates results. */
export class DisconnectedWebRetriever implements WebRetriever {
  readonly id = "web-disconnected";
  readonly connected = false;

  async retrieve(input: {
    access: AccessContext;
    plan: RetrievalPlan;
    query: string;
  }): Promise<RetrievedItem[]> {
    if (!input.access?.userId) throw new Error("ACCESS_CONTEXT_REQUIRED");
    void input.query;
    // SearXNG / crawlers plug in later. Fake search is forbidden.
    return [];
  }
}

/** Research worker / SearXNG path — disconnected stub, no fake browsing. */
export class DisconnectedResearchRetriever implements ResearchRetriever {
  readonly id = "research-disconnected";
  readonly connected = false;

  async retrieve(input: {
    access: AccessContext;
    plan: RetrievalPlan;
    query: string;
  }): Promise<RetrievedItem[]> {
    if (!input.access?.userId) throw new Error("ACCESS_CONTEXT_REQUIRED");
    void input.plan;
    void input.query;
    return [];
  }
}
