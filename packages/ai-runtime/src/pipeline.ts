import type { AnswerPipelineDeps, RunAnswerPipelineInput } from "./ports.js";
import type { AnswerResult, RetrievedItem } from "./types.js";
import { recordAnswerDiagnostic } from "./diagnostics.js";
import { readRetrieverStats } from "./retrievers/web-intelligence.js";

function isInternal(item: RetrievedItem): boolean {
  return item.sourceType === "knowledge" || item.sourceType === "knowledge_chunk";
}

function isWeb(item: RetrievedItem): boolean {
  return item.sourceType === "web";
}

function isResearch(item: RetrievedItem): boolean {
  return item.sourceType === "research";
}

/**
 * Canonical AI answer pipeline.
 * Domain never depends on a concrete LLM or search engine — only ports.
 * Internal and web retrieval are independent: a zero on one side does not skip the other.
 */
export async function runAnswerPipeline(
  deps: AnswerPipelineDeps,
  input: RunAnswerPipelineInput,
): Promise<AnswerResult> {
  const started = Date.now();
  let failureStage: string | null = null;
  const retrievalTypes: Array<"internal" | "web" | "research"> = [];
  let retrievedCount = 0;
  let planNeedInternal = false;
  let planNeedWeb = false;
  let planNeedDeep = false;

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
    planNeedInternal = plan.needInternalKnowledge;
    planNeedWeb = plan.needWeb;
    planNeedDeep = plan.needDeepResearch;

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

    // Deep research already runs search + optional page fetch.
    // Do not double-call Tavily via the shallow web retriever.
    failureStage = "retrieval_web";
    let webError: string | null = null;
    if (plan.needWeb && !plan.needDeepResearch) {
      retrievalTypes.push("web");
      try {
        const items = await deps.web.retrieve({
          access: input.request.access,
          plan,
          query: input.request.userText,
        });
        collected.push(...items);
      } catch (err) {
        webError = err instanceof Error ? err.message : "WEB_SEARCH_FAILED";
      }
    }

    failureStage = "retrieval_research";
    if (plan.needDeepResearch) {
      retrievalTypes.push("research");
      try {
        const items = await deps.research.retrieve({
          access: input.request.access,
          plan,
          query: input.request.userText,
        });
        collected.push(...items);
      } catch (err) {
        webError = err instanceof Error ? err.message : "WEB_RESEARCH_FAILED";
      }
    }

    retrievedCount = collected.length;
    const internalCount = collected.filter(isInternal).length;
    const webCount = collected.filter(isWeb).length;
    const researchCount = collected.filter(isResearch).length;
    const webStats = plan.needDeepResearch
      ? readRetrieverStats(deps.research)
      : readRetrieverStats(deps.web);

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
    if (webError) {
      const reason =
        webError === "WEB_SEARCH_UNCONFIGURED"
          ? "Web検索が未接続のため、外部調査は実行していません。"
          : `Web検索を実行できませんでした（${webError.slice(0, 80)}）。検索したようには装っていません。`;
      answer.limitations = [...answer.limitations, reason];
      if (!answer.text.includes(reason)) {
        answer.text = `${answer.text}\n\n${reason}`.trim();
      }
    }

    answer.retrieval = {
      internalCount,
      webCount,
      researchCount,
      contextCount: context.items.length,
      citationCount: answer.citations.length,
      sanitizedQueryCount: webStats.sanitizedQueryCount,
      pagesFetched: webStats.pagesFetched,
      browserSessions: webStats.browserSessions,
    };

    const usedFallback =
      modelOut.providerId === "honest-fallback" || (modelOut.fallbackCount ?? 0) > 0;
    const trace = {
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
      internalCount,
      webCount,
      researchCount,
      contextCount: context.items.length,
      citationCount: answer.citations.length,
      sanitizedQueryCount: webStats.sanitizedQueryCount,
      pagesFetched: webStats.pagesFetched,
      browserSessions: webStats.browserSessions,
      needInternal: plan.needInternalKnowledge,
      needWeb: plan.needWeb,
      needDeepResearch: plan.needDeepResearch,
      modelConnected: modelOut.connected,
      providerRequestResult: (usedFallback
        ? modelOut.connected
          ? "fallback"
          : "failed"
        : "ok") as "ok" | "fallback" | "failed",
      fallbackReason: usedFallback
        ? modelOut.connected
          ? "provider_request_failed"
          : "no_connected_provider"
        : null,
    };
    recordAnswerDiagnostic(trace);
    deps.onTrace?.(trace);

    return answer;
  } catch (err) {
    const failTrace = {
      intent: input.request.workflowHint ?? "general",
      retrievalTypes,
      retrievedCount,
      modelProvider: deps.model.id,
      latencyMs: Date.now() - started,
      failureStage: failureStage ?? "unknown",
      success: false,
      needInternal: planNeedInternal,
      needWeb: planNeedWeb,
      needDeepResearch: planNeedDeep,
      modelConnected: deps.model.connected,
      providerRequestResult: "failed" as const,
      fallbackReason: failureStage ?? "unknown",
    };
    recordAnswerDiagnostic(failTrace);
    deps.onTrace?.(failTrace);
    throw err;
  }
}
