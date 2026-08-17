import { normalizeKnowledgeText } from "./hash.js";
import type {
  KnowledgeCandidateType,
  KnowledgeFactStatus,
  KnowledgeOriginKind,
} from "./factory-types.js";

export type ExtractedCandidateDraft = {
  title: string;
  content: string;
  summary: string;
  candidateType: KnowledgeCandidateType;
  factStatus: KnowledgeFactStatus;
  excerpt: string;
  applicability: string | null;
  exceptions: string | null;
  paraphrases: string[];
  domainKeys: string[];
  tags: string[];
  confidence: number;
  sourceQuality: number;
  sourceChunkIndex: number | null;
};

export type KnowledgeExtractor = {
  readonly id: string;
  readonly usesModel: boolean;
  extract(input: {
    originKind: KnowledgeOriginKind;
    title: string;
    text: string;
    chunkIndex: number | null;
    question?: string | null;
    answer?: string | null;
    domainKeys?: string[];
  }): Promise<ExtractedCandidateDraft[]>;
};

const SPECULATIVE_RE = /検討|仮説|案として|かもしれない|未定|却下|見送り/;
const DECISION_RE = /決定|方針|承認された|確定/;
const PROCEDURE_RE = /手順|ステップ|まず|次に/;

function inferType(text: string, originKind: KnowledgeOriginKind): KnowledgeCandidateType {
  if (originKind === "qa") return "qa";
  if (PROCEDURE_RE.test(text)) return "procedure";
  if (DECISION_RE.test(text)) return "decision";
  if (/定義|とは/.test(text)) return "definition";
  return "knowhow";
}

function inferFactStatus(text: string): KnowledgeFactStatus {
  if (/却下|見送り|採用しない/.test(text)) return "rejected";
  if (/仮説|かもしれない/.test(text)) return "hypothesis";
  if (SPECULATIVE_RE.test(text)) return "proposal";
  if (DECISION_RE.test(text)) return "decision";
  return "fact";
}

function titleFrom(text: string, fallback: string): string {
  const first = normalizeKnowledgeText(text).split(/\n/)[0] ?? fallback;
  return first.slice(0, 120) || fallback;
}

/**
 * Deterministic extractor. Does not call an LLM.
 * Conservative: speculative language stays proposal/hypothesis, never "current fact".
 */
export class HeuristicKnowledgeExtractor implements KnowledgeExtractor {
  readonly id = "heuristic";
  readonly usesModel = false;

  async extract(input: {
    originKind: KnowledgeOriginKind;
    title: string;
    text: string;
    chunkIndex: number | null;
    question?: string | null;
    answer?: string | null;
    domainKeys?: string[];
  }): Promise<ExtractedCandidateDraft[]> {
    const text = normalizeKnowledgeText(input.text);
    if (!text) return [];
    const domainKeys = input.domainKeys?.length ? input.domainKeys : ["company_common"];

    if (input.question && input.answer) {
      const q = normalizeKnowledgeText(input.question);
      const a = normalizeKnowledgeText(input.answer);
      return [
        {
          title: q.slice(0, 120),
          content: `Q: ${q}\n\nA: ${a}`,
          summary: a.slice(0, 280),
          candidateType: "qa",
          factStatus: inferFactStatus(a),
          excerpt: a.slice(0, 500),
          applicability: null,
          exceptions: null,
          paraphrases: [q],
          domainKeys,
          tags: ["qa"],
          confidence: 0.7,
          sourceQuality: 0.8,
          sourceChunkIndex: input.chunkIndex,
        },
        {
          title: titleFrom(a, input.title),
          content: a,
          summary: a.slice(0, 280),
          candidateType: "knowhow",
          factStatus: inferFactStatus(a) === "fact" ? "proposal" : inferFactStatus(a),
          excerpt: a.slice(0, 500),
          applicability: "専門家Q&Aから一般化した候補。原文Q&Aを優先すること。",
          exceptions: null,
          paraphrases: [],
          domainKeys,
          tags: ["generalized"],
          confidence: 0.45,
          sourceQuality: 0.6,
          sourceChunkIndex: input.chunkIndex,
        },
      ];
    }

    return [
      {
        title: titleFrom(text, input.title),
        content: text.slice(0, 8_000),
        summary: text.slice(0, 280),
        candidateType: inferType(text, input.originKind),
        factStatus: inferFactStatus(text),
        excerpt: text.slice(0, 500),
        applicability: null,
        exceptions: null,
        paraphrases: [],
        domainKeys,
        tags: [],
        confidence: 0.5,
        sourceQuality: input.originKind === "conversation" ? 0.35 : 0.55,
        sourceChunkIndex: input.chunkIndex,
      },
    ];
  }
}

export function createDefaultKnowledgeExtractor(): KnowledgeExtractor {
  return new HeuristicKnowledgeExtractor();
}
