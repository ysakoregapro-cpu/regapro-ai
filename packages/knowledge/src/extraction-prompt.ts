import type { KnowledgeOriginKind } from "./factory-types.js";
import { LLM_PROMPT_VERSION } from "./extraction-schema.js";

export const KNOWLEDGE_EXTRACTION_SYSTEM_POLICY = [
  "あなたは社内 Knowledge Candidate の構造化抽出器です。回答アシスタントではありません。",
  "Source に書かれた再利用可能な業務 Knowledge だけを抽出してください。",
  "会社固有情報を一般知識から生成しないでください。証拠が無い内容は補完しないでください。",
  "各候補は Source excerpt（原文抜粋）必須です。抜粋できない候補は出さないでください。",
  "出力は JSON オブジェクトのみ。説明文・Markdown・コードフェンスは禁止です。",
  "",
  "次を混同しないこと:",
  "- 現在の確定事実 / 過去の事実",
  "- 決定 / 方針 / 手順",
  "- 提案 / 仮説 / 却下案",
  "- 個人の意見 / AIの推測",
  "「検討している」≠「実施している」。「予定」≠「完了」。「申請中」≠「取得済み」。「昔そうだった」≠「現在もそう」。",
].join("\n");

export function buildKnowledgeExtractionUserPrompt(input: {
  originKind: KnowledgeOriginKind;
  title: string;
  chunkId: string;
  chunkText: string;
  heuristicNotes: string;
  domainKeys: string[];
  isConversation: boolean;
}): string {
  const conversationRules = input.isConversation
    ? [
        "この Source は会話/transcript です。organization Knowledge 候補にしてはいけないもの:",
        "health / mental health / medical / politics / religion / intimate personal relationships /",
        "unrelated private life / loyalty / private complaints / private emotional statements /",
        "authentication data / credentials / secrets。",
        "ただし案件の失敗から作った運用ルールなど、業務再利用可能な記述は候補にしてよい。",
        "private な会話を organization 公開範囲へ広げない。",
      ].join("\n")
    : "会話由来でない Source です。機微な私生活は候補化しない。";

  return [
    `promptVersion: ${LLM_PROMPT_VERSION}`,
    `originKind: ${input.originKind}`,
    `title: ${input.title}`,
    `sourceChunkId: ${input.chunkId}`,
    `preferredDomains: ${input.domainKeys.join(",")}`,
    `heuristicPreanalysis: ${input.heuristicNotes}`,
    conversationRules,
    "",
    "JSON schema:",
    '{"candidates":[{"candidateType":"fact|policy|procedure|decision|strategy|knowhow|qa|definition|organization|historical_event","factStatus":"fact|decision|proposal|hypothesis|rejected|historical","title":"","summary":"","normalizedStatement":"","domains":["company_common"],"categories":[],"tags":[],"validFrom":null,"validUntil":null,"observedAt":null,"sourceDate":null,"isCurrent":true,"confidence":0.0,"sourceQuality":0.0,"evidence":{"sourceChunkId":"","excerpt":""},"suggestedRelations":{}}],"skippedPrivate":false}',
    "",
    "Source chunk:",
    input.chunkText,
  ].join("\n");
}
