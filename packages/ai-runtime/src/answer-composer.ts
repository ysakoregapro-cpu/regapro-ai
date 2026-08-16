import type { AnswerComposer } from "./ports.js";
import type { AnswerResult, SourceType } from "./types.js";
import type { ModelGenerateOutput } from "./ports.js";

function provenanceOf(sourceType: SourceType): "internal" | "web" {
  return sourceType === "web" || sourceType === "research" ? "web" : "internal";
}

export class DefaultAnswerComposer implements AnswerComposer {
  compose(input: {
    model: ModelGenerateOutput;
    context: {
      items: {
        citation: AnswerResult["citations"][number];
        sourceType?: SourceType;
      }[];
    };
    plan: AnswerResult["retrievalPlan"];
    intent: AnswerResult["intent"];
  }): AnswerResult {
    const citations = input.context.items.map((i) => ({
      ...i.citation,
      provenance: i.citation.provenance ?? provenanceOf(i.citation.sourceType),
    }));

    const usedInternalKnowledge = input.context.items.some(
      (i) =>
        i.citation.sourceType === "knowledge" ||
        i.citation.sourceType === "knowledge_chunk",
    );
    const usedWeb = input.context.items.some(
      (i) =>
        i.citation.sourceType === "web" || i.citation.sourceType === "research",
    );

    return {
      text: input.model.text,
      citations,
      usedInternalKnowledge,
      usedWeb,
      model: {
        providerId: input.model.providerId,
        modelId: input.model.modelId,
        connected: input.model.connected,
        role: input.model.role ?? null,
        fallbackCount: input.model.fallbackCount ?? 0,
        usage: input.model.usage ?? null,
        estimatedCostUsd: input.model.estimatedCostUsd ?? null,
      },
      retrievalPlan: input.plan,
      intent: input.intent,
      confidence: input.model.confidence,
      limitations: input.model.limitations,
      generatedAt: new Date().toISOString(),
      retrieval: {
        internalCount: 0,
        webCount: 0,
        researchCount: 0,
        contextCount: input.context.items.length,
        citationCount: citations.length,
        sanitizedQueryCount: 0,
        pagesFetched: 0,
      },
    };
  }
}
