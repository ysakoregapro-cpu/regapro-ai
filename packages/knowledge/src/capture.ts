const CAPTURE_RE =
  /ナレッジに追加|ナレッジにして|Knowledge候補|ナレッジ候補|覚えて(?:おいて|て)|今後このルールで運用|この回答を.{0,12}ナレッジ|このやり取りを.{0,20}Knowledge|このやり取りを.{0,20}ナレッジ/i;

export function isKnowledgeCaptureUtterance(text: string): boolean {
  return CAPTURE_RE.test(text.trim());
}

export type ConversationCaptureInput = {
  userQuestion: string;
  assistantAnswer: string;
  evidenceTitles: string[];
  instruction: string;
  visibility: string;
  containsPersonalConversation: boolean;
};

export type ConversationCapturePlan = {
  allowed: boolean;
  reason: string;
  title: string;
  content: string;
  sourceQuality: number;
};

const PERSONAL_BLOCK_RE =
  /健康|病歴|宗教|政治|忠誠|内部告発|プライベート|私生活|恋愛|家族の病気|パスワード|認証情報/;

/**
 * Conversational capture stays a candidate. Private/personal material is not promoted.
 */
export function planConversationCapture(
  input: ConversationCaptureInput,
): ConversationCapturePlan {
  if (input.containsPersonalConversation || input.visibility === "private") {
    return {
      allowed: false,
      reason: "private_or_personal",
      title: "",
      content: "",
      sourceQuality: 0,
    };
  }
  const blob = `${input.userQuestion}\n${input.assistantAnswer}\n${input.instruction}`;
  if (PERSONAL_BLOCK_RE.test(blob)) {
    return {
      allowed: false,
      reason: "sensitive_personal_material",
      title: "",
      content: "",
      sourceQuality: 0,
    };
  }

  const title =
    input.userQuestion.replace(/\s+/g, " ").trim().slice(0, 80) || "会話からのナレッジ候補";
  const evidence =
    input.evidenceTitles.length > 0
      ? `根拠: ${input.evidenceTitles.slice(0, 8).join(" / ")}`
      : "根拠: 会話時点の回答（未検証）";
  const content = [
    `指示: ${input.instruction}`,
    `質問: ${input.userQuestion}`,
    evidence,
    `回答: ${input.assistantAnswer}`,
  ].join("\n\n");

  return {
    allowed: true,
    reason: "ok",
    title,
    content: content.slice(0, 8_000),
    sourceQuality: input.evidenceTitles.length > 0 ? 0.45 : 0.25,
  };
}
