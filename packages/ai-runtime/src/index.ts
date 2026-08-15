export type * from "./types.js";
export type * from "./ports.js";

export { RuleBasedIntentRouter } from "./intent-router.js";
export { DefaultRetrievalPlanner } from "./retrieval-plan.js";
export { DefaultContextBuilder } from "./context-builder.js";
export { DefaultAnswerComposer } from "./answer-composer.js";
export { runAnswerPipeline } from "./pipeline.js";
export { createAnswerRuntimeLogger } from "./observability.js";
export {
  BasicInternalKnowledgeRetriever,
  DisconnectedWebRetriever,
  DisconnectedResearchRetriever,
  type KnowledgeCandidate,
} from "./retrievers/basic.js";
export {
  HybridInternalKnowledgeRetriever,
  type KnowledgeSearchHit,
  type KnowledgeSearchPort,
} from "./retrievers/hybrid.js";
export {
  HonestFallbackModelProvider,
  BrowserLocalModelProviderSlot,
} from "./model/honest-fallback.js";

import { RuleBasedIntentRouter } from "./intent-router.js";
import { DefaultRetrievalPlanner } from "./retrieval-plan.js";
import { DefaultContextBuilder } from "./context-builder.js";
import { DefaultAnswerComposer } from "./answer-composer.js";
import {
  BasicInternalKnowledgeRetriever,
  DisconnectedResearchRetriever,
  DisconnectedWebRetriever,
  type KnowledgeCandidate,
} from "./retrievers/basic.js";
import { HybridInternalKnowledgeRetriever } from "./retrievers/hybrid.js";
import type { KnowledgeSearchPort } from "./retrievers/hybrid.js";
import { HonestFallbackModelProvider } from "./model/honest-fallback.js";
import { createAnswerRuntimeLogger } from "./observability.js";
import type { AnswerPipelineDeps, InternalKnowledgeRetriever } from "./ports.js";
import type { AccessContext } from "@regapro/security";
import type { EmbeddingProvider } from "@regapro/knowledge";
import { createDefaultEmbeddingProvider } from "@regapro/knowledge";

/** Factory for default (honest / disconnected) pipeline deps. */
export function createDefaultAnswerPipelineDeps(input?: {
  loadKnowledge?: (args: {
    access: AccessContext;
    query: string;
  }) => Promise<KnowledgeCandidate[]>;
  /** When set, uses HybridInternalKnowledgeRetriever (Supabase RPC adapter). */
  knowledgeSearch?: KnowledgeSearchPort;
  embedding?: EmbeddingProvider;
  internalKnowledge?: InternalKnowledgeRetriever;
  onTrace?: AnswerPipelineDeps["onTrace"];
}): AnswerPipelineDeps {
  const logger = createAnswerRuntimeLogger();

  let internalKnowledge: InternalKnowledgeRetriever;
  if (input?.internalKnowledge) {
    internalKnowledge = input.internalKnowledge;
  } else if (input?.knowledgeSearch) {
    internalKnowledge = new HybridInternalKnowledgeRetriever(
      input.knowledgeSearch,
      input.embedding ?? createDefaultEmbeddingProvider(),
    );
  } else {
    internalKnowledge = new BasicInternalKnowledgeRetriever(
      input?.loadKnowledge ?? (async () => []),
    );
  }

  return {
    intentRouter: new RuleBasedIntentRouter(),
    retrievalPlanner: new DefaultRetrievalPlanner(),
    internalKnowledge,
    web: new DisconnectedWebRetriever(),
    research: new DisconnectedResearchRetriever(),
    contextBuilder: new DefaultContextBuilder(),
    model: new HonestFallbackModelProvider(),
    answerComposer: new DefaultAnswerComposer(),
    onTrace: input?.onTrace ?? ((t) => logger.emit(t)),
  };
}
