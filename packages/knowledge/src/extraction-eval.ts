import { parseStructuredExtraction } from "./extraction-schema.js";
import type { KnowledgeFactStatus } from "./factory-types.js";

export type ExtractionEvalCase = {
  id: "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J";
  title: string;
  source: string;
  originKind: "paste" | "qa" | "conversation";
  expect: {
    factStatus?: KnowledgeFactStatus;
    isCurrent?: boolean;
    skippedPrivate?: boolean;
    minCandidates?: number;
    maxCandidates?: number;
  };
};

export const KNOWLEDGE_EXTRACTION_EVAL_CASES: ExtractionEvalCase[] = [
  {
    id: "A",
    title: "現在実施中",
    originKind: "paste",
    source: "現在、有料職業紹介事業を実施している。許可は取得済みである。",
    expect: { factStatus: "fact", isCurrent: true, minCandidates: 1 },
  },
  {
    id: "B",
    title: "検討中",
    originKind: "paste",
    source: "有料職業紹介の許可取得を検討している。まだ申請していない。",
    expect: { factStatus: "proposal", isCurrent: false, minCandidates: 1 },
  },
  {
    id: "C",
    title: "過去はA、現在はB",
    originKind: "paste",
    source: "過去は許可取得準備中だった。現在は許可を取得済みである。",
    expect: { factStatus: "fact", isCurrent: true, minCandidates: 1 },
  },
  {
    id: "D",
    title: "却下案",
    originKind: "paste",
    source: "週休3日案は出たが却下された。採用しない。",
    expect: { factStatus: "rejected", minCandidates: 1 },
  },
  {
    id: "E",
    title: "Q&A一般原則",
    originKind: "qa",
    source: "Q: 部下へ仕事を振る時は？\nA: 範囲と期限を先に合意する。",
    expect: { factStatus: "fact", minCandidates: 1 },
  },
  {
    id: "F",
    title: "個人会話と業務ルール混在",
    originKind: "conversation",
    source:
      "昨日は体調が悪くて休んだ。○○案件で見積漏れがあり、今後は提出前に二人確認する運用ルールにした。",
    expect: { factStatus: "decision", minCandidates: 1 },
  },
  {
    id: "G",
    title: "同じ事実の重複",
    originKind: "paste",
    source: "営業方針はヒアリングを先にする。営業方針はヒアリングを先にする。",
    expect: { factStatus: "fact", minCandidates: 1 },
  },
  {
    id: "H",
    title: "新旧矛盾",
    originKind: "paste",
    source: "有料職業紹介の許可は未取得である。有料職業紹介の許可は取得済みである。",
    expect: { factStatus: "fact", minCandidates: 1 },
  },
  {
    id: "I",
    title: "粒度: 再利用単位",
    originKind: "paste",
    source:
      "RegaloProfessional の運用原則。仕事を振る前に範囲と期限を合意する。見積は提出前に二人確認する。許可取得済みの事業は現在実施中として扱う。個人の役職や価値観は原則にしない。",
    expect: { factStatus: "fact", minCandidates: 1, maxCandidates: 3 },
  },
  {
    id: "J",
    title: "個人プロフィールは候補化しない",
    originKind: "conversation",
    source: "酒匂のAIに対する考え方として、役職は代表で個人的な価値観はこうだ。",
    expect: { skippedPrivate: true, minCandidates: 0, maxCandidates: 0 },
  },
];

export function scoreExtractionEval(input: {
  caseId: ExtractionEvalCase["id"];
  jsonText: string;
}): { pass: boolean; reason: string } {
  const spec = KNOWLEDGE_EXTRACTION_EVAL_CASES.find((c) => c.id === input.caseId);
  if (!spec) return { pass: false, reason: "unknown_case" };
  const parsed = parseStructuredExtraction(input.jsonText);
  if (!parsed.ok) return { pass: false, reason: parsed.detail };
  if (spec.expect.skippedPrivate && !parsed.value.skippedPrivate) {
    return { pass: false, reason: "expected_skipped_private" };
  }
  if ((parsed.value.candidates.length) < (spec.expect.minCandidates ?? 0)) {
    return { pass: false, reason: "too_few_candidates" };
  }
  if (
    spec.expect.maxCandidates != null &&
    parsed.value.candidates.length > spec.expect.maxCandidates
  ) {
    return { pass: false, reason: "too_many_candidates" };
  }
  if (!spec.expect.factStatus) {
    return { pass: true, reason: "ok" };
  }
  const hit = parsed.value.candidates.find((c) => c.factStatus === spec.expect.factStatus);
  if (!hit) return { pass: false, reason: `missing_status_${spec.expect.factStatus}` };
  if (spec.expect.isCurrent != null && hit.isCurrent !== spec.expect.isCurrent) {
    return { pass: false, reason: "is_current_mismatch" };
  }
  return { pass: true, reason: "ok" };
}
