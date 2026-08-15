import type { EmbeddingProvider, EmbeddingVector } from "@regapro/knowledge";
import {
  ACTIVE_EMBEDDING_MANIFEST,
  type EmbeddingModelManifest,
} from "./embedding-manifest.js";

type FeatureExtractionPipeline = (
  text: string,
  options?: { pooling?: string; normalize?: boolean },
) => Promise<{ data: Float32Array | number[]; dims: number[] }>;

/**
 * Node-local EmbeddingProvider backed by Transformers.js (ONNX).
 * Never invents vectors — if the model cannot load or dims mismatch, throws.
 *
 * Separate from Local LLM / chat models.
 */
export class TransformersJsEmbeddingProvider implements EmbeddingProvider {
  readonly id = "embedding-transformers-js";
  readonly available = true;
  readonly dimensions: number;

  private extractor: FeatureExtractionPipeline | null = null;
  private loadPromise: Promise<void> | null = null;
  private readonly manifest: EmbeddingModelManifest;

  constructor(manifest: EmbeddingModelManifest = ACTIVE_EMBEDDING_MANIFEST) {
    this.manifest = manifest;
    this.dimensions = manifest.dimensions;
  }

  get modelId(): string {
    return this.manifest.modelId;
  }

  get modelVersion(): string {
    return this.manifest.modelVersion;
  }

  async embedDocuments(texts: string[]): Promise<EmbeddingVector[]> {
    const out: EmbeddingVector[] = [];
    for (const text of texts) {
      out.push(
        await this.embedOne(`${this.manifest.documentPrefix}${text}`),
      );
    }
    return out;
  }

  async embedQuery(text: string): Promise<EmbeddingVector> {
    return this.embedOne(`${this.manifest.queryPrefix}${text}`);
  }

  private async embedOne(prefixed: string): Promise<EmbeddingVector> {
    await this.ensureLoaded();
    if (!this.extractor) {
      throw new Error("EMBEDDING_MODEL_NOT_LOADED");
    }
    const result = await this.extractor(prefixed, {
      pooling: "mean",
      normalize: true,
    });
    const values = Array.from(result.data as ArrayLike<number>);
    if (values.length !== this.dimensions) {
      throw new Error(
        `EMBEDDING_DIMENSION_MISMATCH: got ${values.length}, expected ${this.dimensions} for ${this.manifest.modelId}`,
      );
    }
    if (values.every((v) => v === 0)) {
      throw new Error("EMBEDDING_ZERO_VECTOR_REJECTED");
    }
    return {
      values,
      modelId: this.manifest.modelId,
      modelVersion: this.manifest.modelVersion,
      dimensions: this.dimensions,
    };
  }

  private async ensureLoaded(): Promise<void> {
    if (this.extractor) return;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      const { pipeline } = await import("@huggingface/transformers");
      const extractor = await pipeline(
        "feature-extraction",
        this.manifest.hfModelId,
      );

      // multilingual-e5-small (XLM-R tokenizer + BertModel) requires token_type_ids.
      const anyExtractor = extractor as unknown as {
        tokenizer?: {
          prepare_model_inputs?: (inputs: Record<string, unknown>) => Record<
            string,
            unknown
          >;
        };
      };
      if (anyExtractor.tokenizer) {
        anyExtractor.tokenizer.prepare_model_inputs = (model_inputs) => {
          const attention = model_inputs.attention_mask as {
            clone: () => { data: { fill: (v: bigint) => void } };
          };
          const token_type_ids = attention.clone();
          token_type_ids.data.fill(0n);
          return { ...model_inputs, token_type_ids };
        };
      }

      this.extractor = extractor as unknown as FeatureExtractionPipeline;
    })();

    try {
      await this.loadPromise;
    } catch (err) {
      this.loadPromise = null;
      this.extractor = null;
      throw err;
    }
  }
}

export type EmbeddingRuntimeMode = "transformers" | "disconnected";

export function resolveEmbeddingRuntimeMode(
  env: NodeJS.ProcessEnv = process.env,
): EmbeddingRuntimeMode {
  const raw = (env.REGAPRO_EMBEDDING_RUNTIME ?? "transformers").toLowerCase();
  if (raw === "disconnected" || raw === "off" || raw === "0") {
    return "disconnected";
  }
  return "transformers";
}
