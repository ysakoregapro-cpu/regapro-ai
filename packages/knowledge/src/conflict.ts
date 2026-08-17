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
  sourceQuality?: number | null;
  originKind?: string | null;
  sourceDate?: string | null;
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
  isCurrent?: boolean;
  sourceQuality?: number | null;
  originKind?: string | null;
  sourceDate?: string | null;
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
    const incomingHistorical =
      input.factStatus === "historical" || input.isCurrent === false;
    if (incomingHistorical && !existingHistorical) {
      return {
        kind: "conflict",
        existingId: best.row.id,
        reason: "historical_candidate_vs_current",
      };
    }
    if (!existingHistorical && !incomingHistorical) {
      const incomingSeed = input.originKind === "authoritative_seed";
      const existingSeed = best.row.originKind === "authoritative_seed";
      const incomingQuality = input.sourceQuality ?? 0;
      const existingQuality = best.row.sourceQuality ?? 0;
      if (incomingSeed && !existingSeed && incomingQuality >= existingQuality) {
        return {
          kind: "supersession",
          existingId: best.row.id,
          reason: "authoritative_seed_vs_older_topic",
        };
      }
      if (!incomingSeed && existingSeed && incomingQuality < existingQuality) {
        return {
          kind: "conflict",
          existingId: best.row.id,
          reason: "older_source_vs_authoritative_seed",
        };
      }
      return {
        kind: "supersession",
        existingId: best.row.id,
        reason: "same_topic_needs_review",
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

/** Conflicts, uncertain supersession, and security widening must not be batch-approved. */
export function canBatchApprove(input: {
  reviewStatus: string;
  conflictKind: string;
  conflictReason?: string | null;
  suggestedVisibility?: string | null;
  sourceVisibility?: string | null;
  confidence?: number | null;
  sourceQuality?: number | null;
}): boolean {
  if (input.conflictKind === "conflict") return false;
  if (input.reviewStatus === "conflict") return false;
  if (input.conflictKind === "supersession") return false;
  if (input.reviewStatus === "possible_update") return false;
  if (input.reviewStatus === "duplicate") return false;
  if (
    input.sourceVisibility === "private" &&
    input.suggestedVisibility &&
    input.suggestedVisibility !== "private"
  ) {
    return false;
  }
  if ((input.confidence ?? 1) < 0.55) return false;
  if ((input.sourceQuality ?? 1) < 0.4) return false;
  return input.reviewStatus === "new" && input.conflictKind === "new";
}

export function sourceQualityForOrigin(originKind: string): number {
  if (originKind === "authoritative_seed") return 0.95;
  if (originKind === "qa") return 0.8;
  if (originKind === "file" || originKind === "paste") return 0.7;
  if (originKind === "url" || originKind === "research") return 0.55;
  if (originKind === "conversation" || originKind === "transcript") return 0.35;
  return 0.5;
}

export function preferAuthoritativeCurrent<
  T extends {
    current?: boolean;
    factStatus?: string | null;
    sourceQuality?: number | null;
    originKind?: string | null;
  },
>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ac = a.current === false || a.factStatus === "historical" ? 0 : 1;
    const bc = b.current === false || b.factStatus === "historical" ? 0 : 1;
    if (bc !== ac) return bc - ac;
    const aq = a.sourceQuality ?? sourceQualityForOrigin(a.originKind ?? "");
    const bq = b.sourceQuality ?? sourceQualityForOrigin(b.originKind ?? "");
    return bq - aq;
  });
}
