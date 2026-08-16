import type { AccessContext } from "@regapro/security";
import type { RetrievalPlanner } from "./ports.js";
import type { IntentDecision, RetrievalPlan } from "./types.js";

function hybridSignals(text: string | undefined): {
  wantWeb: boolean;
  wantInternal: boolean;
} {
  const t = text ?? "";
  return {
    wantWeb: /市場|業界|競合|最新|採用市場|公開情報|調べて/.test(t),
    wantInternal: /組織|KPI|社内|課題|人員|規程|過去/.test(t),
  };
}

export class DefaultRetrievalPlanner implements RetrievalPlanner {
  plan(input: {
    intent: IntentDecision;
    access: AccessContext;
    text?: string;
  }): RetrievalPlan {
    void input.access; // ceiling applied at retrieval; plan stays declarative
    const intent = input.intent.intent;
    const signals = hybridSignals(input.text);

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
          needProjectContext: true,
          needDepartmentContext: true,
          needCitations: true,
        };
      case "web_search":
        return {
          ...base,
          needWeb: true,
          needInternalKnowledge: true,
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
          needWeb: signals.wantWeb && signals.wantInternal,
          needCitations: signals.wantWeb,
        };
    }
  }
}
