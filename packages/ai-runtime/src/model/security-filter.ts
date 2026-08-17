import type { AccessContext } from "@regapro/security";
import type { ConfidentialityLevel } from "@regapro/shared";
import type { AIContext, AIContextItem } from "../types.js";

const SECRET_RE =
  /(sk-[a-zA-Z0-9]{10,}|api[_-]?key\s*[:=]\s*\S+|Bearer\s+[A-Za-z0-9._-]+)/gi;
const PII_RE =
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|0\d{1,4}-\d{2,4}-\d{4}/gi;

export type OutboundLlmPayload = {
  system: string;
  user: string;
  items: AIContextItem[];
  zeroDataRetention: boolean;
  disallowPromptTraining: boolean;
  metadataOnlyTrace: boolean;
  ceiling: ConfidentialityLevel;
};

function redact(text: string): string {
  return text.replace(SECRET_RE, "[REDACTED]").replace(PII_RE, "[REDACTED]");
}

function isElevated(level: ConfidentialityLevel): boolean {
  return level === "people" || level === "executive";
}

function isWeb(item: AIContextItem): boolean {
  return item.sourceType === "web" || item.sourceType === "research";
}

/**
 * Filter BEFORE the LLM call. Never "retrieve all then ask the model to hide it".
 */
export function filterOutboundLlmPayload(input: {
  access: AccessContext;
  userText: string;
  context: AIContext;
  task?: "answer" | "knowledge_extraction";
  systemOverride?: string;
}): OutboundLlmPayload {
  const ceiling = input.context.ceiling;
  const elevated =
    isElevated(ceiling) || isElevated(input.access.threadConfidentialityLevel);

  const items = input.context.items.filter((item) => item.sourceType !== "conversation");
  const internal = items.filter((i) => !isWeb(i));
  const web = items.filter(isWeb);

  const formatBlock = (label: string, rows: AIContextItem[]) => {
    if (rows.length === 0) {
      return `${label}: なし。この区分の事実は補完しないでください。件数は本文に書かないでください。`;
    }
    return [
      `${label}: ${rows.length}件`,
      ...rows.map((i, idx) => {
        return `[#${idx + 1} ${i.source}] ${redact(i.content).slice(0, 1200)}`;
      }),
    ].join("\n");
  };

  const system = input.systemOverride
    ? [
        input.systemOverride,
        elevated
          ? "この依頼は社内の取り扱い区分が高いため、推測で機密を補完してはいけません。"
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    : [
        "あなたは RegaloProfessional の業務アシスタントです。",
        "会社固有の事実は「社内出典」に書かれた内容だけを使ってください。無い事実は一般知識で補完しないでください。",
        "社内出典が無い場合は、社内の現状を「確認できない」と書いてください。件数や hidden な資料名は書かないでください。",
        "外部出典がある場合は、社内が無くても外部に基づいて公開情報を整理してください。社内事実と混同しないでください。",
        "本文に knowledge:// や内部URI、『根拠：』の箇条書き、「出典：internal」を書かないでください。引用はシステムが右側に出します。必要なときだけ [1] [2] と番号だけ書いてください。",
        "検索した・調べたと主張せず、渡された出典だけを使ってください。",
        elevated
          ? "この依頼は社内の取り扱い区分が高いため、推測で機密を補完してはいけません。"
          : "",
      ]
        .filter(Boolean)
        .join("\n");

  const user =
    input.task === "knowledge_extraction"
      ? [`抽出依頼:\n${redact(input.userText)}`, formatBlock("社内出典", internal)].join("\n\n")
      : [
          `依頼:\n${redact(input.userText)}`,
          formatBlock("社内出典", internal),
          formatBlock("外部出典", web),
        ].join("\n\n");

  return {
    system,
    user,
    items,
    zeroDataRetention: elevated,
    disallowPromptTraining: elevated,
    metadataOnlyTrace: elevated,
    ceiling,
  };
}

export function gatewayProviderOptions(input: {
  zeroDataRetention: boolean;
  disallowPromptTraining: boolean;
  allowlist: string[];
}): Record<string, unknown> {
  const gateway: Record<string, unknown> = {};
  if (input.zeroDataRetention) gateway.zeroDataRetention = true;
  if (input.disallowPromptTraining) gateway.disallowPromptTraining = true;
  if (input.allowlist.length > 0) gateway.only = input.allowlist;
  return Object.keys(gateway).length ? { gateway } : {};
}
