/**
 * EmbeddingProvider — separate from Local LLM / chat models.
 * Domain never depends on a vendor SDK or a provisional vector size.
 */

export type EmbeddingVector = {
  /** Length must match the active model (see EmbeddingProvider.dimensions). */
  values: number[];
  modelId: string;
  modelVersion: string;
  dimensions: number;
};

export type EmbeddingProvider = {
  readonly id: string;
  /** False ⇒ callers MUST NOT invent vectors; use lexical-only fallback. */
  readonly available: boolean;
  /** Active model output size — DB column must match this at write/search time. */
  readonly dimensions: number;
  embedDocuments(texts: string[]): Promise<EmbeddingVector[]>;
  embedQuery(text: string): Promise<EmbeddingVector>;
};

/**
 * @deprecated Prefer model manifest dimensions from @regapro/local-ai.
 * Kept only so callers fail closed if they wrongly assume OpenAI-1536.
 */
export const LEGACY_PROVISIONAL_EMBEDDING_DIMENSIONS = 1536;

/**
 * Default production provider when no self-hosted / worker model is wired.
 * Never returns random or fake vectors.
 */
export class DisconnectedEmbeddingProvider implements EmbeddingProvider {
  readonly id = "embedding-disconnected";
  readonly available = false;
  /** Unknown until a model is selected — 0 signals "do not search by vector". */
  readonly dimensions = 0;

  async embedDocuments(_texts: string[]): Promise<EmbeddingVector[]> {
    throw new Error("EMBEDDING_PROVIDER_DISCONNECTED");
  }

  async embedQuery(_text: string): Promise<EmbeddingVector> {
    throw new Error("EMBEDDING_PROVIDER_DISCONNECTED");
  }
}

/**
 * Slot retained for alternate worker-local backends (TEI / Ollama).
 * available stays false until a real implementation is configured.
 */
export class WorkerLocalEmbeddingProviderSlot implements EmbeddingProvider {
  readonly id = "embedding-worker-local-slot";
  readonly available = false;
  readonly dimensions = 0;

  async embedDocuments(_texts: string[]): Promise<EmbeddingVector[]> {
    throw new Error("EMBEDDING_PROVIDER_NOT_CONNECTED");
  }

  async embedQuery(_text: string): Promise<EmbeddingVector> {
    throw new Error("EMBEDDING_PROVIDER_NOT_CONNECTED");
  }
}

export function createDefaultEmbeddingProvider(): EmbeddingProvider {
  return new DisconnectedEmbeddingProvider();
}
