import type { SanitizedQueryPlan } from "./types.js";

/**
 * Bounded query expansion from already-sanitized queries only.
 * Never fans out from the original unsanitized request.
 */
export function expandSanitizedQueries(
  plan: SanitizedQueryPlan,
  maxQueries: number,
): string[] {
  const cap = Math.max(1, maxQueries);
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (q: string) => {
    const t = q.replace(/\s+/g, " ").trim().slice(0, 80);
    if (t.length < 2 || seen.has(t) || out.length >= cap) return;
    seen.add(t);
    out.push(t);
  };

  for (const q of plan.sanitizedQueries) push(q);

  const seed = plan.sanitizedQueries.join(" ");
  if (/市場|業界|競合|採用|組織/.test(seed)) {
    if (/通信|telecom/i.test(seed)) push("通信業界 市場動向 日本");
    if (/採用|求人|人材/.test(seed)) push("採用市場 動向 日本");
    if (/組織|経営/.test(seed)) push("組織設計 公開事例");
  }

  return out.slice(0, cap);
}
