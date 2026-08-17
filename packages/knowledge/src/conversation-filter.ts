import type { KnowledgeOriginKind } from "./factory-types.js";

const BLOCK_RE =
  /健康|体調|メンタル|精神|病歴|医療|診断|宗教|政治|忠誠|内部告発|プライベート|私生活|恋愛|親密|愚痴|感情的に辛い|パスワード|APIキー|api[_-]?key|secret|credential|認証情報|Bearer\s+[A-Za-z0-9._-]+/i;

const WORK_RULE_RE =
  /運用ルール|今後は|手順|方針|案件|失敗したので|再発防止|許可|契約|顧客|提案/;

export type ConversationFilterDecision = {
  allowOrganizationCandidate: boolean;
  reason: string;
  sanitizedText: string;
};

/**
 * Conversation/transcript safety: do not candidate private life / secrets
 * as organization Knowledge. Keep reusable work rules.
 */
export function filterConversationForOrganizationKnowledge(input: {
  originKind: KnowledgeOriginKind;
  text: string;
  visibility: string;
  containsPersonalConversation?: boolean;
}): ConversationFilterDecision {
  const isConversation =
    input.originKind === "conversation" || input.originKind === "transcript";
  if (!isConversation) {
    return {
      allowOrganizationCandidate: input.visibility !== "private",
      reason: "not_conversation",
      sanitizedText: input.text,
    };
  }
  if (input.containsPersonalConversation || input.visibility === "private") {
    return {
      allowOrganizationCandidate: false,
      reason: "private_source",
      sanitizedText: input.text,
    };
  }

  const lines = input.text.split(/\n+/);
  const kept: string[] = [];
  let blocked = 0;
  for (const line of lines) {
    if (BLOCK_RE.test(line) && !WORK_RULE_RE.test(line)) {
      blocked += 1;
      continue;
    }
    if (BLOCK_RE.test(line) && WORK_RULE_RE.test(line)) {
      kept.push(line);
      continue;
    }
    kept.push(line);
  }
  const sanitizedText = kept.join("\n").trim();
  if (!sanitizedText) {
    return {
      allowOrganizationCandidate: false,
      reason: "all_private_or_empty",
      sanitizedText: "",
    };
  }
  return {
    allowOrganizationCandidate: true,
    reason: blocked > 0 ? "filtered_private_lines" : "ok",
    sanitizedText,
  };
}

export function isSensitiveOrganizationBlock(text: string): boolean {
  return BLOCK_RE.test(text) && !WORK_RULE_RE.test(text);
}
