/**
 * Embedding model manifests — dimensions follow the model, never a provisional DB default.
 * Domain ports stay in @regapro/knowledge; this package owns runtimes.
 */

export type EmbeddingModelManifest = {
  /** Stable id stored on knowledge_chunks.embedding_model */
  modelId: string;
  /** Human / registry name (HF id) */
  hfModelId: string;
  modelVersion: string;
  dimensions: number;
  /**
   * E5 family expects asymmetric prefixes for retrieval quality.
   * Other models may leave these empty.
   */
  queryPrefix: string;
  documentPrefix: string;
  multilingual: boolean;
};

/** Active default for Local Embedding Runtime Phase. */
export const MULTILINGUAL_E5_SMALL: EmbeddingModelManifest = {
  modelId: "multilingual-e5-small",
  hfModelId: "Xenova/multilingual-e5-small",
  modelVersion: "onnx-main",
  dimensions: 384,
  queryPrefix: "query: ",
  documentPrefix: "passage: ",
  multilingual: true,
};

export const ACTIVE_EMBEDDING_MANIFEST = MULTILINGUAL_E5_SMALL;
