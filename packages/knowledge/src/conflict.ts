import { normalizeKnowledgeText, sha256Hex } from "./hash.js";
import type { KnowledgeConflictKind, KnowledgeFactStatus } from "./factory-types.js";

export type ExistingKnowledgeRef = {
  id: string;
  title: string;
  body: string;
  factStatus?: KnowledgeFactStatus | string | null;
  validFrom?: string | null;
  validUntil?: string | null;
  current?: boolean;
};

export type ConflictDecision = {
  kind: KnowledgeConflictKind;
  existingId: string | null;
  reason: string;
};

function titleKey(title: string): string {
  return normalizeKnowledgeText(title).toLowerCase().replace(/\s+/g, "");
}

function sharedPrefixScore(a: string, b: string): number {
  const x = titleKey(a);
  const y = titleKey(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.8;
  let n = 0;
  const limit = Math.min(x.length, y.length, 24);
  for (let i = 0; i < limit; i++) {
    if (x[i] === y[i]) n += 1;
    else break;
  }
  return n / Math.max(x.length, y.length);
}

/**
 * Classify a candidate against published (or current) knowledge.
 * Never deletes or mutates existing rows.
 */
export function classifyKnowledgeConflict(input: {
  title: string;
  body: string;
  factStatus?: KnowledgeFactStatus | string | null;
  existing: ExistingKnowledgeRef[];
}): ConflictDecision {
  const bodyHash = sha256Hex(normalizeKnowledgeText(input.body));
  for (const row of input.existing) {
    const existingHash = sha256Hex(normalizeKnowledgeText(row.body));
    if (existingHash === bodyHash) {
      return {
        kind: "duplicate",
        existingId: row.id,
        reason: "identical_content_hash",
      };
    }
  }

  let best: { row: ExistingKnowledgeRef; score: number } | null = null;
  for (const row of input.existing) {
    const score = sharedPrefixScore(input.title, row.title);
    if (!best || score > best.score) best = { row, score };
  }

  if (best && best.score >= 0.8) {
    const existingHistorical =
      best.row.factStatus === "historical" || best.row.current === false;
    const incomingHistorical = input.factStatus === "historical";
    if (!existingHistorical && !incomingHistorical) {
      return {
        kind: "supersession",
        existingId: best.row.id,
        reason: "same_topic_newer_candidate",
      };
    }
    return {
      kind: "conflict",
      existingId: best.row.id,
      reason: "same_topic_divergent_status",
    };
  }

  return { kind: "new", existingId: null, reason: "no_match" };
}

export function preferCurrentKnowledge<T extends { current?: boolean; factStatus?: string | null }>(
  rows: T[],
  queryLooksHistorical: boolean,
): T[] {
  if (queryLooksHistorical) return rows;
  const current = rows.filter(
    (r) => r.current !== false && r.factStatus !== "historical",
  );
  return current.length ? current : rows;
}

export function queryLooksHistorical(text: string): boolean {
  return /当時|以前|過去|去年|昨年|当時の|いつから/.test(text);
}

/** Conflicts must not be batch-approved; they need an explicit supersede/reject. */
export function canBatchApprove(input: {
  reviewStatus: string;
  conflictKind: string;
}): boolean {
  if (input.conflictKind === "conflict") return false;
  if (input.reviewStatus === "conflict") return false;
  return (
    input.reviewStatus === "new" ||
    input.reviewStatus === "possible_update" ||
    input.reviewStatus === "duplicate"
  );
}
