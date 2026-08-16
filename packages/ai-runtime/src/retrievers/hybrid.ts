import type { AccessContext } from "@regapro/security";
import {
  confidentialityFromRank,
  type ConfidentialityLevel,
  type Visibility,
} from "@regapro/shared";
import type {
  EmbeddingProvider,
  KnowledgeReranker,
} from "@regapro/knowledge";
import {
  createDefaultEmbeddingProvider,
  PassthroughKnowledgeReranker,
  reciprocalRankFusion,
} from "@regapro/knowledge";
import type { InternalKnowledgeRetriever } from "../ports.js";
import type { RetrievedItem, RetrievalPlan } from "../types.js";

/** Raw hit from SQL/RPC or in-memory search — security already applied. */
export type KnowledgeSearchHit = {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  content: string;
  confidentialityLevel: number;
  visibility: string;
  ownerUserId: string | null;
  projectId: string | null;
  departmentId: string | null;
  sourceType: string | null;
  updatedAt: string | null;
  rank: number;
  score: number;
};

/**
 * Port implemented by Supabase RPC adapters (or tests).
 * Must apply AccessContext / RLS before returning rows — never fetch-all-then-mask.
 */
export type KnowledgeSearchPort = {
  lexicalSearch(input: {
    access: AccessContext;
    query: string;
    limit: number;
  }): Promise<KnowledgeSearchHit[]>;
  vectorSearch(input: {
    access: AccessContext;
    queryEmbedding: number[];
    limit: number;
  }): Promise<KnowledgeSearchHit[]>;
};

function levelFromDb(n: number): ConfidentialityLevel {
  return confidentialityFromRank(n);
}

function freshnessBoost(updatedAt: string | null): number {
  if (!updatedAt) return 1;
  const days = (Date.now() - Date.parse(updatedAt)) / 86_400_000;
  if (!Number.isFinite(days)) return 1;
  if (days < 90) return 1.2;
  if (days < 365) return 1;
  return 0.85;
}

function toRetrieved(
  hit: HybridRow,
): RetrievedItem {
  const excerpt = hit.content.slice(0, 240);
  return {
    id: hit.chunkId,
    title: hit.documentTitle,
    content: hit.content.slice(0, 2000),
    sourceType: "knowledge_chunk",
    sourceId: hit.documentId,
    sourceUri: `knowledge://document/${hit.documentId}/chunk/${hit.chunkId}`,
    confidentialityLevel: levelFromDb(hit.confidentialityLevel),
    visibility: (hit.visibility as Visibility) || "organization",
    ownerUserId: hit.ownerUserId ?? undefined,
    relevance: Math.min(1, hit.relevance * freshnessBoost(hit.updatedAt)),
    freshness: hit.updatedAt,
    excerpt,
  };
}

type HybridRow = KnowledgeSearchHit & {
  lexicalRank: number | null;
  vectorRank: number | null;
  finalRank: number;
  relevance: number;
  chunkId: string;
  documentTitle: string;
  documentId: string;
  content: string;
  confidentialityLevel: number;
  visibility: string;
  ownerUserId: string | null;
  updatedAt: string | null;
};

/**
 * Hybrid Internal Knowledge Retriever (lexical + optional vector via RRF).
 * When EmbeddingProvider.available === false, lexical-only — never fake vectors.
 */
export class HybridInternalKnowledgeRetriever implements InternalKnowledgeRetriever {
  readonly id = "internal-knowledge-hybrid";

  constructor(
    private readonly search: KnowledgeSearchPort,
    private readonly embedding: EmbeddingProvider = createDefaultEmbeddingProvider(),
    private readonly reranker: KnowledgeReranker<HybridRow> = new PassthroughKnowledgeReranker(),
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
      return [];
    }
    if (input.plan.includePrivateConversations) {
      return [];
    }
    if (!input.plan.needInternalKnowledge) return [];

    const limit = 40;
    const lexical = await this.search.lexicalSearch({
      access: input.access,
      query: input.query,
      limit,
    });

    let vector: KnowledgeSearchHit[] = [];
    if (this.embedding.available && this.embedding.dimensions > 0) {
      try {
        const emb = await this.embedding.embedQuery(input.query);
        if (emb.values.length !== this.embedding.dimensions) {
          throw new Error("EMBEDDING_DIMENSION_MISMATCH");
        }
        vector = await this.search.vectorSearch({
          access: input.access,
          queryEmbedding: emb.values,
          limit,
        });
      } catch {
        // Honest fallback: keep lexical-only rather than inventing vector hits.
        vector = [];
      }
    }

    const fused = reciprocalRankFusion({
      lexical: lexical.map((h) => ({ ...h, id: h.chunkId, rank: h.rank })),
      vector: vector.map((h) => ({ ...h, id: h.chunkId, rank: h.rank })),
      k: 60,
      limit: 20,
    }) as HybridRow[];

    const reranked = await this.reranker.rerank({
      query: input.query,
      hits: fused,
    });

    return reranked.map(toRetrieved);
  }
}
