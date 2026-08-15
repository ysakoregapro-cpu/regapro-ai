import type { AnswerComposer } from "./ports.js";
import type { AnswerResult } from "./types.js";

export class DefaultAnswerComposer implements AnswerComposer {
  compose(input: {
    model: {
      text: string;
      confidence: number;
      providerId: AnswerResult["model"]["providerId"];
      modelId: string;
      connected: boolean;
      limitations: string[];
    };
    context: { items: { citation: AnswerResult["citations"][number] }[] };
    plan: AnswerResult["retrievalPlan"];
    intent: AnswerResult["intent"];
  }): AnswerResult {
    const citations = input.plan.needCitations
      ? input.context.items.map((i) => i.citation)
      : [];

    const usedInternalKnowledge = input.context.items.some(
      (i) =>
        i.citation.sourceType === "knowledge" ||
        i.citation.sourceType === "knowledge_chunk",
    );
    const usedWeb = input.context.items.some(
      (i) => i.citation.sourceType === "web",
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
      },
      retrievalPlan: input.plan,
      intent: input.intent,
      confidence: input.model.confidence,
      limitations: input.model.limitations,
      generatedAt: new Date().toISOString(),
    };
  }
}
