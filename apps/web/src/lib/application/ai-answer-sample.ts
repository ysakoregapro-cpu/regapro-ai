import {
  createDefaultAnswerPipelineDeps,
  HonestFallbackModelProvider,
  runAnswerPipeline,
  type AnswerIntent,
  type AnswerResult,
  type WorkflowAnswerHints,
} from "@regapro/ai-runtime";
import type { AccessContext } from "@regapro/security";
import { listKnowledge } from "@/lib/application/catalog-service";
import { createCodingRuntimePort } from "@/lib/application/coding-runtime-service";

export function workflowToAnswerIntent(
  workflow: string | null | undefined,
): AnswerIntent | null {
  switch (workflow) {
    case "research":
      return "web_search";
    case "document":
    case "prompt":
      return "document";
    case "task":
      return "task";
    case "file_review":
      return "file_review";
    case "code":
      return "code";
    case "general":
      return null;
    default:
      return null;
  }
}

function sampleKnowledgeLoader(access: AccessContext, query: string) {
  void query;
  return listKnowledge().map((k) => ({
    id: k.id,
    title: k.title,
    body: `${k.title}\n${k.category}\n${k.business}`,
    confidentialityLevel: "company" as const,
    visibility: k.visibility,
    ownerUserId: "system",
    published: true,
    updatedAt: null,
    projectId: null,
    departmentId: access.departmentId,
  }));
}

/**
 * Dev-sample / in-memory answer path — safe for modules shared with client.
 * Supabase hybrid search lives in generateAssistantAnswer (server-only entry).
 */
export async function generateSampleAssistantAnswer(input: {
  access: AccessContext;
  threadId: string;
  messageId: string | null;
  userText: string;
  workflowHint?: AnswerIntent | null;
  hints?: WorkflowAnswerHints;
}): Promise<AnswerResult> {
  const model = new HonestFallbackModelProvider();
  const deps = createDefaultAnswerPipelineDeps({
    loadKnowledge: async ({ access, query }) =>
      sampleKnowledgeLoader(access, query),
    model,
    codingRuntime: createCodingRuntimePort({ access: input.access, model }),
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
