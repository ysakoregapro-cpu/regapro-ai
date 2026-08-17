import type { ConfidentialityLevel } from "@regapro/shared";
import type { SanitizedQueryPlan } from "./types.js";

const PERSON_SAN = /[\p{Script=Han}]{1,4}さん/gu;
const COMPENSATION_RE =
  /実給与|実際の給与|賞与額|個人別の報酬|給与明細|評価点|未公開評価|年収\s*\d+|手取り/;
const HEALTH_RE = /健康情報|病歴|メンタル|通院|診断|障害等級/;
const COMPLAINT_RE = /内部告発|ハラスメント|苦情|懲戒|未公開人事/;
const PII_RE =
  /電話番号|メールアドレス|住所|マイナンバー|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const INTERNAL_ID_RE = /\b(user|proj|org|mem|dept)-[a-z0-9-]+\b/i;
const UNPUBLISHED_RE = /未公開|社内限定|confidential|経営会議メモ/gi;

function hasPersonMention(text: string): boolean {
  PERSON_SAN.lastIndex = 0;
  return PERSON_SAN.test(text);
}

export type SanitizeInput = {
  request: string;
  confidentialityLevel: ConfidentialityLevel;
  extraNamePattern?: RegExp;
};

/**
 * Converts a user request into public-safe web queries.
 * Never forwards private conversation, L2/L3 internals, or PII.
 */
export function sanitizeExternalQuery(input: SanitizeInput): SanitizedQueryPlan {
  const originalRequest = input.request.trim();
  const removed: string[] = [];
  let working = originalRequest;

  const nameRe = input.extraNamePattern
    ? new RegExp(
        `(?:${input.extraNamePattern.source})|(?:${PERSON_SAN.source})`,
        "gu",
      )
    : PERSON_SAN;

  if (hasPersonMention(working) || (input.extraNamePattern && input.extraNamePattern.test(working))) {
    removed.push("person_name");
    working = working.replace(nameRe, " ").trim();
  }
  if (COMPENSATION_RE.test(originalRequest)) {
    removed.push("compensation");
    working = working.replace(COMPENSATION_RE, " ").replace(/と比較|比べて|比較して/g, " ");
  }
  if (HEALTH_RE.test(originalRequest)) {
    removed.push("health");
    working = working.replace(HEALTH_RE, " ");
  }
  if (COMPLAINT_RE.test(originalRequest)) {
    removed.push("complaint");
    working = working.replace(COMPLAINT_RE, " ");
  }
  if (PII_RE.test(working)) {
    removed.push("personal_data");
    working = working.replace(PII_RE, " ");
  }
  if (INTERNAL_ID_RE.test(working)) {
    removed.push("internal_id");
    working = working.replace(INTERNAL_ID_RE, " ");
  }
  if (UNPUBLISHED_RE.test(working)) {
    removed.push("unpublished_marker");
    working = working.replace(UNPUBLISHED_RE, " ");
  }

  working = working.replace(/\s+/g, " ").trim();

  const queries: string[] = [];
  const wantsMarketPay =
    /平均給与|平均年収|給与相場|適正給与|年収の相場|年収相場/.test(originalRequest) ||
    removed.includes("compensation");
  const wantsJobs = /求人|転職|採用市場|向く仕事/.test(originalRequest);

  if (wantsMarketPay) {
    queries.push("事業推進責任者 年収 日本");
    queries.push("DX推進責任者 給与相場");
  }
  if (wantsJobs) {
    const publicSkills: string[] = [];
    if (/Java/i.test(originalRequest)) publicSkills.push("Java");
    if (/SES/.test(originalRequest)) publicSkills.push("SES");
    if (/東京/.test(originalRequest)) publicSkills.push("東京");
    if (/開発/.test(originalRequest)) publicSkills.push("開発職");
    queries.push(
      ["求人", ...publicSkills].join(" ").slice(0, 80) || "開発職 求人 日本",
    );
  }

  const topic = working
    .replace(/さん|教えて|比較|調べて|して|この人に/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (
    topic.length >= 2 &&
    !wantsMarketPay &&
    !removed.includes("personal_data") &&
    !removed.includes("health") &&
    !removed.includes("complaint")
  ) {
    queries.push(topic.slice(0, 80));
  }

  const unique = [...new Set(queries.filter((q) => q.trim().length >= 2))];

  const blockedPii = removed.includes("personal_data") || removed.includes("health");
  const l1 = input.confidentialityLevel === "company";
  const allowed =
    unique.length > 0 &&
    !blockedPii &&
    (l1 || wantsMarketPay || wantsJobs);

  return {
    originalRequest,
    sanitizedQueries: unique,
    removedSensitiveSignals: removed,
    requiresConfirmation: removed.length > 0,
    confidentialityLevel: input.confidentialityLevel,
    externalTransmissionAllowed: allowed,
  };
}

export function assertNoSensitiveInExternalQueries(plan: SanitizedQueryPlan): void {
  for (const q of plan.sanitizedQueries) {
    PERSON_SAN.lastIndex = 0;
    COMPENSATION_RE.lastIndex = 0;
    HEALTH_RE.lastIndex = 0;
    if (PERSON_SAN.test(q) || COMPENSATION_RE.test(q) || HEALTH_RE.test(q)) {
      throw new Error("External query contains sensitive content");
    }
  }
}
