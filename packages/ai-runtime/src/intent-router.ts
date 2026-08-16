import type { IntentRouter } from "./ports.js";
import type { AnswerIntent, IntentDecision } from "./types.js";
import { extractRetrievalSignals } from "./retrieval-signals.js";

const TOOL_HINTS = new Set<AnswerIntent>([
  "task",
  "document",
  "code",
  "file_review",
]);

/**
 * Deterministic intent routing. `general` workflow is not a lock —
 * text can still require web / internal / deep research.
 */
export class RuleBasedIntentRouter implements IntentRouter {
  async route(input: {
    text: string;
    workflowHint?: AnswerIntent | null;
  }): Promise<IntentDecision> {
    if (input.workflowHint && TOOL_HINTS.has(input.workflowHint)) {
      return {
        intent: input.workflowHint,
        confidence: 0.95,
        reason: `workflow_hint:${input.workflowHint}`,
        provider: "rules",
      };
    }

    const text = input.text.trim();
    const signals = extractRetrievalSignals(text);

    if (signals.wantDeep && (signals.wantWeb || signals.wantInternal)) {
      return {
        intent: "deep_research",
        confidence: 0.86,
        reason: "hybrid_internal_web_deep",
        provider: "rules",
      };
    }

    const checks: Array<{ intent: AnswerIntent; re: RegExp; reason: string }> =
      [
        {
          intent: "deep_research",
          re: /深く調べ|詳細調査|deep\s*research|網羅的/,
          reason: "deep_research_phrase",
        },
        {
          intent: "web_search",
          re: /調べて|調査|検索して|web|最新情報|ネットで|外部環境/,
          reason: "web_search_phrase",
        },
        {
          intent: "internal_knowledge",
          re: /社内|ナレッジ|規程|マニュアル|過去の資料|社内資料|取り組み/,
          reason: "internal_knowledge_phrase",
        },
        {
          intent: "task",
          re: /タスク|TODO|やること|期限|担当にして/,
          reason: "task_phrase",
        },
        {
          intent: "document",
          re: /議事録|資料|文面|ドキュメント|提案書|下書き/,
          reason: "document_phrase",
        },
        {
          intent: "code",
          re: /コード|実装|Cursor|TypeScript|リファクタ/,
          reason: "code_phrase",
        },
        {
          intent: "file_review",
          re: /添付|ファイルを見て|レビューして|このPDF/,
          reason: "file_review_phrase",
        },
      ];

    for (const c of checks) {
      if (c.re.test(text)) {
        return {
          intent: c.intent,
          confidence: 0.8,
          reason: c.reason,
          provider: "rules",
        };
      }
    }

    if (input.workflowHint === "web_search" || input.workflowHint === "deep_research") {
      return {
        intent: input.workflowHint,
        confidence: 0.9,
        reason: `workflow_hint:${input.workflowHint}`,
        provider: "rules",
      };
    }

    return {
      intent: "general",
      confidence: 0.55,
      reason: "default_general",
      provider: "rules",
    };
  }
}

export type LocalLlmIntentRouterFactory = (deps: {
  complete: (prompt: string) => Promise<string>;
}) => IntentRouter;
