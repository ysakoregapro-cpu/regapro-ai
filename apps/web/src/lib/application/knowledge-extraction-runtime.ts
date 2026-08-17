import "server-only";
import {
  VercelGatewayModelProvider,
  type AIContextItem,
  type ModelGenerateInput,
  type ModelProvider,
} from "@regapro/ai-runtime";
import {
  KNOWLEDGE_EXTRACTION_SYSTEM_POLICY,
  type KnowledgeExtractionGenerate,
  type KnowledgeExtractionModelRole,
} from "@regapro/knowledge";
import type { AccessContext } from "@regapro/security";
import type { ConfidentialityLevel } from "@regapro/shared";

function emptyPlan(): ModelGenerateInput["plan"] {
  return {
    intent: "document",
    needInternalKnowledge: true,
    needWeb: false,
    needDeepResearch: false,
    needProjectContext: false,
    needDepartmentContext: false,
    needCitations: false,
    needToolExecution: false,
    includePrivateConversations: false,
    includeAuditCases: false,
  };
}

/**
 * Direct role call — do not use answer FallbackChain (it may skip LLM).
 */
export function createKnowledgeExtractionGenerate(input: {
  access: AccessContext;
  confidentialityLevel: ConfidentialityLevel;
  chunkTitle: string;
  chunkText: string;
  provider?: ModelProvider | null;
}): KnowledgeExtractionGenerate | null {
  const provider = input.provider ?? new VercelGatewayModelProvider();
  if (!provider.connected) return null;

  const item: AIContextItem = {
    id: "source-chunk",
    content: input.chunkText.slice(0, 8_000),
    source: input.chunkTitle,
    sourceType: "knowledge",
    confidentialityLevel: input.confidentialityLevel,
    citation: {
      id: "source-chunk",
      title: input.chunkTitle,
      sourceType: "knowledge",
      sourceId: "source-chunk",
      uri: null,
      excerpt: input.chunkText.slice(0, 280),
      confidentialityLevel: input.confidentialityLevel,
      relevance: 1,
      provenance: "internal",
    },
    freshness: null,
    relevance: 1,
  };

  return async (req) => {
    const out = await provider.generate({
      access: input.access,
      userText: req.user,
      context: {
        items: [item],
        ceiling: input.confidentialityLevel,
        rejectedCount: 0,
        budgetHints: { maxItems: 1, maxChars: 8_000 },
      },
      plan: emptyPlan(),
      intent: {
        intent: "document",
        confidence: 1,
        reason: "knowledge_extraction",
        provider: "rules",
      },
      role: req.role,
      task: "knowledge_extraction",
      systemOverride: req.system || KNOWLEDGE_EXTRACTION_SYSTEM_POLICY,
    });
    return {
      text: out.text,
      modelId: out.modelId,
      role: (out.role as KnowledgeExtractionModelRole | undefined) ?? req.role,
      connected: out.connected,
      usage: out.usage ?? null,
      estimatedCostUsd: out.estimatedCostUsd ?? null,
    };
  };
}
