import "server-only";
import {
  createDefaultAnswerPipelineDeps,
  runAnswerPipeline,
  type AnswerIntent,
  type AnswerResult,
  type PipelineTrace,
  type WorkflowAnswerHints,
} from "@regapro/ai-runtime";
import { createEmbeddingProvider } from "@regapro/local-ai";
import { emitRuntimeTrace } from "@regapro/observability";
import type { AccessContext } from "@regapro/security";
import { isDevSampleMode } from "@/lib/supabase/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createSupabaseKnowledgeSearchPort } from "@/lib/application/knowledge-search-port";
import {
  generateSampleAssistantAnswer,
  workflowToAnswerIntent,
} from "@/lib/application/ai-answer-sample";
import {
  createCloudModelProviderFromEnv,
  createWebRetrieversFromEnv,
} from "@/lib/application/ai-runtime-factory";

export { workflowToAnswerIntent, generateSampleAssistantAnswer };

/**
 * Application-service entry for the AI Answer Runtime (server-only).
 * Never import this module from Client Components.
 * Clearance is taken from AccessContext only — never from request body.
 */
export async function generateAssistantAnswer(input: {
  access: AccessContext;
  threadId: string;
  messageId: string | null;
  userText: string;
  workflowHint?: AnswerIntent | null;
  hints?: WorkflowAnswerHints;
}): Promise<AnswerResult> {
  if (isDevSampleMode()) {
    return generateSampleAssistantAnswer(input);
  }

  const client = await createServerSupabaseClient();
  const { web, research } = createWebRetrieversFromEnv();
  const model = createCloudModelProviderFromEnv();

  const deps = createDefaultAnswerPipelineDeps({
    knowledgeSearch: createSupabaseKnowledgeSearchPort(client),
    embedding: createEmbeddingProvider(),
    web,
    research,
    model,
    onTrace: (trace: PipelineTrace) => {
      void emitRuntimeTrace({
        name: "regapro.answer",
        requestId: input.messageId ?? input.threadId,
        intent: trace.intent,
        workflow: input.workflowHint ?? trace.intent,
        selectedModelRole: trace.selectedModelRole ?? null,
        actualModelId: trace.actualModelId,
        providerRoute: trace.modelProvider,
        fallbackCount: trace.fallbackCount,
        retrievalCounts: {
          internal: trace.retrievalTypes.includes("internal") ? 1 : 0,
          web: trace.retrievalTypes.includes("web") ? 1 : 0,
          research: trace.retrievalTypes.includes("research") ? 1 : 0,
        },
        latencyMs: trace.latencyMs,
        tokenUsage: trace.tokenUsage ?? null,
        estimatedCostUsd: trace.estimatedCostUsd ?? null,
        success: trace.success !== false && !trace.failureStage,
        confidentialityLevel: input.access.threadConfidentialityLevel,
        evaluationTags: [trace.intent],
      });
    },
  });

  return runAnswerPipeline(deps, {
    request: {
      organizationId: input.access.organizationId,
      userId: input.access.userId,
      threadId: input.threadId,
      messageId: input.messageId,
      userText: input.userText,
      access: input.access,
      workflowHint: input.workflowHint ?? null,
      allowAuditBypass: false,
    },
    hints: input.hints,
  });
}
