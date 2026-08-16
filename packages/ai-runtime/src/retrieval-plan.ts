import type { AccessContext } from "@regapro/security";
import type { RetrievalPlanner } from "./ports.js";
import type { IntentDecision, RetrievalPlan } from "./types.js";
import { extractRetrievalSignals } from "./retrieval-signals.js";

export class DefaultRetrievalPlanner implements RetrievalPlanner {
  plan(input: {
    intent: IntentDecision;
    access: AccessContext;
    text?: string;
  }): RetrievalPlan {
    void input.access;
    const intent = input.intent.intent;
    const signals = extractRetrievalSignals(input.text);

    const base: RetrievalPlan = {
      intent,
      needInternalKnowledge: false,
      needWeb: false,
      needDeepResearch: false,
      needProjectContext: false,
      needDepartmentContext: false,
      needCitations: false,
      needToolExecution: false,
      includePrivateConversations: false,
      includeAuditCases: false,
    };

    switch (intent) {
      case "internal_knowledge":
        return {
          ...base,
          needInternalKnowledge: true,
          needWeb: signals.wantWeb,
          needDeepResearch: signals.wantDeep,
          needProjectContext: true,
          needDepartmentContext: true,
          needCitations: true,
        };
      case "web_search":
        return {
          ...base,
          needWeb: true,
          needInternalKnowledge: true,
          needDeepResearch: signals.wantDeep,
          needCitations: true,
        };
      case "deep_research":
        return {
          ...base,
          needWeb: true,
          needDeepResearch: true,
          needInternalKnowledge: true,
          needCitations: true,
          needToolExecution: true,
        };
      case "document":
      case "code":
        return {
          ...base,
          needInternalKnowledge: true,
          needWeb: signals.wantWeb,
          needProjectContext: true,
          needToolExecution: true,
          needCitations: true,
        };
      case "task":
        return {
          ...base,
          needToolExecution: true,
          needProjectContext: true,
        };
      case "file_review":
        return {
          ...base,
          needToolExecution: true,
        };
      case "general":
      default:
        return {
          ...base,
          needInternalKnowledge: true,
          needWeb: signals.wantWeb,
          needDeepResearch: signals.wantDeep,
          needCitations: true,
        };
    }
  }
}
