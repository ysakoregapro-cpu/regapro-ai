import "server-only";
import {
  createDefaultAnswerPipelineDeps,
  runAnswerPipeline,
  type AnswerIntent,
  type AnswerResult,
  type WorkflowAnswerHints,
} from "@regapro/ai-runtime";
import { createEmbeddingProvider } from "@regapro/local-ai";
import type { AccessContext } from "@regapro/security";
import { isDevSampleMode } from "@/lib/supabase/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createSupabaseKnowledgeSearchPort } from "@/lib/application/knowledge-search-port";
import {
  generateSampleAssistantAnswer,
  workflowToAnswerIntent,
} from "@/lib/application/ai-answer-sample";

export { workflowToAnswerIntent, generateSampleAssistantAnswer };

/**
 * Application-service entry for the AI Answer Runtime (server-only).
 * Never import this module from Client Components.
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
  const deps = createDefaultAnswerPipelineDeps({
    knowledgeSearch: createSupabaseKnowledgeSearchPort(client),
    embedding: createEmbeddingProvider(),
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
