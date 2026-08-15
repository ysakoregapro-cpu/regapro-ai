import type { EmbeddingProvider } from "@regapro/knowledge";
import { DisconnectedEmbeddingProvider } from "@regapro/knowledge";
import {
  resolveEmbeddingRuntimeMode,
  TransformersJsEmbeddingProvider,
} from "./transformers-embedding.js";

/**
 * Factory for application services. Never returns a "fake available" provider.
 * - transformers: real ONNX multilingual-e5-small (lazy model load on first embed)
 * - disconnected: honest lexical-only path
 */
export function createEmbeddingProvider(
  env: NodeJS.ProcessEnv = process.env,
): EmbeddingProvider {
  const mode = resolveEmbeddingRuntimeMode(env);
  if (mode === "disconnected") {
    return new DisconnectedEmbeddingProvider();
  }
  return new TransformersJsEmbeddingProvider();
}
