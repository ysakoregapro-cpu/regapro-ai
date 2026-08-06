import type { ConfidentialityLevel } from "@regapro/shared";
import { SAMPLE_MEMBERSHIPS } from "@/lib/data/dev-sample/memberships";

export type QueryPlan = {
  originalRequest: string;
  sanitizedQueries: string[];
  removedSensitiveSignals: string[];
  requiresConfirmation: boolean;
  confidentialityLevel: ConfidentialityLevel;
  externalTransmissionAllowed: boolean;
};

const COMPENSATION_RE =
  /実給与|実際の給与|賞与額|個人別の報酬|給与明細|評価点|未公開評価/;
const NAME_RE = (() => {
  const families = SAMPLE_MEMBERSHIPS.map((m) => m.name.split(/\s+/)[0]).filter(
    Boolean,
  ) as string[];
  return new RegExp(`(${families.join("|")})(さん)?`);
})();

const INTERNAL_ID_RE = /\b(user|proj|org|mem|dept)-[a-z0-9-]+\b/i;
const CUSTOMER_PII_RE = /電話番号|メールアドレス|住所|マイナンバー/;

/**
 * Builds external-safe search queries. Never embeds employee names,
 * real compensation, or Level 2/3 internal content in outbound queries.
 */
export function sanitizeExternalQuery(input: {
  request: string;
  confidentialityLevel: ConfidentialityLevel;
}): QueryPlan {
  const originalRequest = input.request.trim();
  const removed: string[] = [];
  let working = originalRequest;

  if (NAME_RE.test(working)) {
    removed.push("person_name");
    working = working.replace(NAME_RE, "").trim();
  }
  if (COMPENSATION_RE.test(originalRequest)) {
    removed.push("compensation");
    working = working
      .replace(COMPENSATION_RE, "")
      .replace(/と比較|比べて|比較して/g, "")
      .trim();
  }
  if (INTERNAL_ID_RE.test(working)) {
    removed.push("internal_id");
    working = working.replace(INTERNAL_ID_RE, "").trim();
  }
  if (CUSTOMER_PII_RE.test(working)) {
    removed.push("personal_data");
    working = working.replace(CUSTOMER_PII_RE, "").trim();
  }
  if (/未公開|社内限定|confidential/i.test(working)) {
    removed.push("unpublished_marker");
    working = working.replace(/未公開|社内限定|confidential/gi, "").trim();
  }

  const queries: string[] = [];
  const wantsMarketPay =
    /平均給与|市場|相場|年収|給与相場|適正給与/.test(originalRequest) ||
    removed.includes("compensation");

  if (wantsMarketPay) {
    queries.push("事業推進責任者 年収 日本");
    queries.push("DX推進責任者 給与相場");
    queries.push("Chief of Staff 年収 日本");
  }

  // Role/topic based public queries from remaining text (no names)
  const topic = working
    .replace(/さん|教えて|比較|調べて|して/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (topic.length >= 2 && !wantsMarketPay) {
    queries.push(topic.slice(0, 80));
  } else if (topic.length >= 2 && wantsMarketPay) {
    // keep market queries only — do not append residual that might still leak
  }

  const unique = [...new Set(queries.filter(Boolean))];
  const externalTransmissionAllowed =
    unique.length > 0 &&
    input.confidentialityLevel === "company" &&
    !removed.includes("personal_data");

  // For L2/L3, still allow sanitized market queries but flag confirmation
  const allowed =
    unique.length > 0 &&
    !removed.includes("personal_data") &&
    (input.confidentialityLevel === "company" || wantsMarketPay);

  return {
    originalRequest,
    sanitizedQueries: unique,
    removedSensitiveSignals: removed,
    requiresConfirmation: removed.length > 0,
    confidentialityLevel: input.confidentialityLevel,
    externalTransmissionAllowed: allowed && externalTransmissionAllowed,
  };
}

export function assertNoSensitiveInExternalQueries(plan: QueryPlan): void {
  for (const q of plan.sanitizedQueries) {
    if (NAME_RE.test(q) || COMPENSATION_RE.test(q)) {
      throw new Error("External query contains sensitive content");
    }
  }
}
