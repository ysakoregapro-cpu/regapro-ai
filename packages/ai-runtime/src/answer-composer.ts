import type { AnswerComposer } from "./ports.js";
import type { AnswerResult, SourceType } from "./types.js";
import type { ModelGenerateOutput } from "./ports.js";

const KNOWLEDGE_URI_RE =
  /knowledge:\/\/document\/[0-9a-f-]+\/chunk\/[0-9a-f-]+/gi;
const PAREN_GROUNDING_RE = /[（(]\s*根拠[:：][^）)]*[）)]/g;
const LINE_GROUNDING_RE = /(?:^|\n)\s*根拠[:：][^\n]*/g;

/** Strip internal URIs and duplicated 根拠 footers from visible answer text. */
export function sanitizeVisibleAnswerText(text: string): string {
  return text
    .replace(KNOWLEDGE_URI_RE, "")
    .replace(PAREN_GROUNDING_RE, "")
    .replace(LINE_GROUNDING_RE, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

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
    coding?: AnswerResult["coding"];
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
      text: sanitizeVisibleAnswerText(input.model.text),
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
      coding: input.coding ?? null,
    };
  }
}
