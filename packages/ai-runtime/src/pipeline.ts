import type { AnswerPipelineDeps, RunAnswerPipelineInput } from "./ports.js";
import type { AnswerResult, RetrievedItem } from "./types.js";

/**
 * Canonical AI answer pipeline.
 * Domain never depends on a concrete LLM or search engine — only ports.
 */
export async function runAnswerPipeline(
  deps: AnswerPipelineDeps,
  input: RunAnswerPipelineInput,
): Promise<AnswerResult> {
  const started = Date.now();
  let failureStage: string | null = null;
  const retrievalTypes: Array<"internal" | "web" | "research"> = [];
  let retrievedCount = 0;

  try {
    if (!input.request.access?.userId) {
      failureStage = "access_context";
      throw new Error("ACCESS_CONTEXT_REQUIRED");
    }
    if (input.request.allowAuditBypass !== false) {
      failureStage = "security";
      throw new Error("AUDIT_BYPASS_FORBIDDEN");
    }
    if (input.request.access.auditMode) {
      failureStage = "security";
      throw new Error("AUDIT_MODE_FORBIDDEN_FOR_ANSWER");
    }

    failureStage = "intent";
    const intent = await deps.intentRouter.route({
      text: input.request.userText,
      workflowHint: input.request.workflowHint,
    });

    failureStage = "retrieval_plan";
    const plan = deps.retrievalPlanner.plan({
      intent,
      access: input.request.access,
      text: input.request.userText,
    });

    // Hard security invariants.
    if (plan.includePrivateConversations !== false) {
      throw new Error("PRIVATE_CONVERSATION_RETRIEVAL_FORBIDDEN");
    }
    if (plan.includeAuditCases !== false) {
      throw new Error("AUDIT_CASE_RETRIEVAL_FORBIDDEN");
    }

    const collected: RetrievedItem[] = [];

    failureStage = "retrieval_internal";
    if (plan.needInternalKnowledge) {
      retrievalTypes.push("internal");
      const items = await deps.internalKnowledge.retrieve({
        access: input.request.access,
        plan,
        query: input.request.userText,
      });
      collected.push(...items);
    }

    failureStage = "retrieval_web";
    if (plan.needWeb) {
      retrievalTypes.push("web");
      const items = await deps.web.retrieve({
        access: input.request.access,
        plan,
        query: input.request.userText,
      });
      // Disconnected providers MUST return [] — never invent hits.
      collected.push(...items);
    }

    failureStage = "retrieval_research";
    if (plan.needDeepResearch) {
      retrievalTypes.push("research");
      const items = await deps.research.retrieve({
        access: input.request.access,
        plan,
        query: input.request.userText,
      });
      collected.push(...items);
    }

    retrievedCount = collected.length;

    failureStage = "context";
    const context = deps.contextBuilder.build({
      access: input.request.access,
      items: collected,
    });

    failureStage = "model";
    const modelOut = await deps.model.generate({
      access: input.request.access,
      userText: input.request.userText,
      context,
      plan,
      intent,
      hints: input.hints,
    });

    failureStage = "compose";
    const answer = deps.answerComposer.compose({
      model: modelOut,
      context,
      plan,
      intent,
    });

    deps.onTrace?.({
      intent: intent.intent,
      retrievalTypes,
      retrievedCount,
      modelProvider: modelOut.providerId,
      selectedModelRole: modelOut.role ?? null,
      actualModelId: modelOut.modelId,
      fallbackCount: modelOut.fallbackCount ?? 0,
      tokenUsage: modelOut.usage ?? null,
      estimatedCostUsd: modelOut.estimatedCostUsd ?? null,
      latencyMs: Date.now() - started,
      failureStage: null,
      success: true,
    });

    return answer;
  } catch (err) {
    deps.onTrace?.({
      intent: input.request.workflowHint ?? "general",
      retrievalTypes,
      retrievedCount,
      modelProvider: deps.model.id,
      latencyMs: Date.now() - started,
      failureStage: failureStage ?? "unknown",
      success: false,
    });
    throw err;
  }
}
