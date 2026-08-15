/**
 * Reciprocal Rank Fusion — stable across lexical vs vector score scales.
 * Optional future reranker can reorder `finalRank` afterwards.
 */

export type RankedRef = {
  id: string;
  rank: number;
};

export type HybridFusedHit<T extends { id: string }> = T & {
  lexicalRank: number | null;
  vectorRank: number | null;
  finalRank: number;
  /** RRF score (higher is better). */
  relevance: number;
};

export function reciprocalRankFusion<T extends { id: string }>(input: {
  lexical: Array<T & { rank: number }>;
  vector: Array<T & { rank: number }>;
  /** Classic RRF constant. */
  k?: number;
  limit?: number;
}): HybridFusedHit<T>[] {
  const k = input.k ?? 60;
  const scores = new Map<string, { item: T; lexicalRank: number | null; vectorRank: number | null; rrf: number }>();

  for (const hit of input.lexical) {
    const rrf = 1 / (k + hit.rank);
    const cur = scores.get(hit.id);
    if (cur) {
      cur.rrf += rrf;
      cur.lexicalRank = hit.rank;
    } else {
      scores.set(hit.id, {
        item: hit,
        lexicalRank: hit.rank,
        vectorRank: null,
        rrf,
      });
    }
  }

  for (const hit of input.vector) {
    const rrf = 1 / (k + hit.rank);
    const cur = scores.get(hit.id);
    if (cur) {
      cur.rrf += rrf;
      cur.vectorRank = hit.rank;
    } else {
      scores.set(hit.id, {
        item: hit,
        lexicalRank: null,
        vectorRank: hit.rank,
        rrf,
      });
    }
  }

  const sorted = [...scores.values()].sort((a, b) => {
    if (b.rrf !== a.rrf) return b.rrf - a.rrf;
    return a.item.id.localeCompare(b.item.id);
  });

  const limit = input.limit ?? sorted.length;
  return sorted.slice(0, limit).map((row, i) => ({
    ...row.item,
    lexicalRank: row.lexicalRank,
    vectorRank: row.vectorRank,
    finalRank: i + 1,
    relevance: row.rrf,
  }));
}

/** Hook point for a future cross-encoder / LLM reranker. */
export type KnowledgeReranker<T> = {
  rerank(input: {
    query: string;
    hits: T[];
  }): Promise<T[]>;
};

export class PassthroughKnowledgeReranker<T> implements KnowledgeReranker<T> {
  async rerank(input: { query: string; hits: T[] }): Promise<T[]> {
    void input.query;
    return input.hits;
  }
}
