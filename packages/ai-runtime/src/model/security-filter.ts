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

/**
 * Filter BEFORE the LLM call. Never "retrieve all then ask the model to hide it".
 * Clearance is taken only from AccessContext — never from request body.
 */
export function filterOutboundLlmPayload(input: {
  access: AccessContext;
  userText: string;
  context: AIContext;
}): OutboundLlmPayload {
  const ceiling = input.context.ceiling;
  const elevated = isElevated(ceiling) || isElevated(input.access.threadConfidentialityLevel);

  const items = input.context.items.filter((item) => {
    if (item.sourceType === "conversation") return false;
    return true;
  });

  const provenance = items
    .map((i, idx) => {
      const kind = i.sourceType === "web" || i.sourceType === "research" ? "web" : "internal";
      return `[#${idx + 1} ${kind} ${i.source}] ${redact(i.content).slice(0, 1200)}`;
    })
    .join("\n\n");

  const system = [
    "あなたは RegaloProfessional の業務アシスタントです。",
    "与えられた出典だけを根拠にしてください。出典に無い事実を作らないでください。",
    "検索したと主張せず、渡された internal / web 出典を区別してください。",
    elevated
      ? "この依頼は社内の取り扱い区分が高いため、推測で機密を補完してはいけません。"
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const user = [`依頼:\n${redact(input.userText)}`, provenance ? `出典:\n${provenance}` : ""]
    .filter(Boolean)
    .join("\n\n");

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
