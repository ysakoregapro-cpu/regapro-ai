import { HeuristicKnowledgeExtractor, type ExtractedCandidateDraft } from "./extractor.js";
import {
  DEFAULT_KNOWLEDGE_EXTRACTION_BUDGET,
  type KnowledgeExtractionBudget,
} from "./budget.js";
import { filterConversationForOrganizationKnowledge } from "./conversation-filter.js";
import {
  HEURISTIC_EXTRACTOR_TYPE,
  HEURISTIC_EXTRACTOR_VERSION,
  LLM_EXTRACTOR_TYPE,
  LLM_EXTRACTOR_VERSION,
  LLM_PROMPT_VERSION,
  parseStructuredExtraction,
  type KnowledgeStructuredCandidate,
} from "./extraction-schema.js";
import {
  buildKnowledgeExtractionUserPrompt,
  KNOWLEDGE_EXTRACTION_SYSTEM_POLICY,
} from "./extraction-prompt.js";
import type { KnowledgeOriginKind } from "./factory-types.js";
import { sha256Hex } from "./hash.js";

export type KnowledgeExtractionModelRole = "fast" | "main" | "reasoning";

export type KnowledgeExtractionGenerateResult = {
  text: string;
  modelId: string;
  role: KnowledgeExtractionModelRole;
  connected: boolean;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
  estimatedCostUsd?: number | null;
};

export type KnowledgeExtractionGenerate = (input: {
  role: KnowledgeExtractionModelRole;
  system: string;
  user: string;
  maxTokens: number;
  timeoutMs: number;
}) => Promise<KnowledgeExtractionGenerateResult>;

export type KnowledgeExtractionCache = {
  get(key: string): Promise<ExtractedCandidateDraft[] | null>;
  set(key: string, value: ExtractedCandidateDraft[]): Promise<void>;
};

export class InMemoryKnowledgeExtractionCache implements KnowledgeExtractionCache {
  private readonly rows = new Map<string, ExtractedCandidateDraft[]>();

  async get(key: string): Promise<ExtractedCandidateDraft[] | null> {
    return this.rows.get(key) ?? null;
  }

  async set(key: string, value: ExtractedCandidateDraft[]): Promise<void> {
    this.rows.set(key, value);
  }
}

export function extractionCacheKey(input: {
  chunkHash: string;
  extractorType: string;
  extractorVersion: string;
  modelId: string;
  promptVersion: string;
}): string {
  return [
    input.chunkHash,
    input.extractorType,
    input.extractorVersion,
    input.modelId || "none",
    input.promptVersion,
  ].join(":");
}

export type KnowledgeExtractionOutcome =
  | {
      status: "extracted";
      drafts: ExtractedCandidateDraft[];
      extractorType: string;
      extractorVersion: string;
      modelRole: KnowledgeExtractionModelRole | null;
      modelId: string | null;
      promptVersion: string;
      cached: boolean;
      usage?: KnowledgeExtractionGenerateResult["usage"];
      estimatedCostUsd?: number | null;
    }
  | {
      status: "waiting_for_extractor";
      reason: string;
      drafts: ExtractedCandidateDraft[];
    }
  | {
      status: "invalid";
      reason: string;
      drafts: ExtractedCandidateDraft[];
    }
  | {
      status: "skipped_private";
      reason: string;
      drafts: ExtractedCandidateDraft[];
    };

export type KnowledgeExtractionProvider = {
  readonly id: string;
  readonly usesModel: boolean;
  extractChunk(input: {
    originKind: KnowledgeOriginKind;
    title: string;
    chunkId: string;
    chunkText: string;
    chunkHash: string;
    chunkIndex: number | null;
    visibility: string;
    domainKeys?: string[];
    question?: string | null;
    answer?: string | null;
    containsPersonalConversation?: boolean;
    needsReasoning?: boolean;
  }): Promise<KnowledgeExtractionOutcome>;
};

function heuristicNotes(drafts: ExtractedCandidateDraft[]): string {
  return drafts
    .slice(0, 3)
    .map((d) => `${d.candidateType}/${d.factStatus}:${d.title}`)
    .join(" | ")
    .slice(0, 400);
}

function toDrafts(
  rows: KnowledgeStructuredCandidate[],
  chunkIndex: number | null,
  originKind: KnowledgeOriginKind,
): ExtractedCandidateDraft[] {
  return rows.map((row) => ({
    title: row.title,
    content: row.normalizedStatement,
    summary: row.summary,
    candidateType: row.candidateType,
    factStatus: row.factStatus,
    excerpt: row.evidence.excerpt,
    applicability: null,
    exceptions: null,
    paraphrases: [],
    domainKeys: row.domains,
    tags: row.tags,
    confidence: row.confidence,
    sourceQuality:
      originKind === "authoritative_seed"
        ? Math.max(row.sourceQuality, 0.9)
        : row.sourceQuality,
    sourceChunkIndex: chunkIndex,
    isCurrent: row.isCurrent,
    validFrom: row.validFrom ?? null,
    validUntil: row.validUntil ?? null,
    observedAt: row.observedAt ?? null,
    sourceDate: row.sourceDate ?? null,
    extractorType: LLM_EXTRACTOR_TYPE,
    extractorVersion: LLM_EXTRACTOR_VERSION,
    promptVersion: LLM_PROMPT_VERSION,
  }));
}

/**
 * Heuristic pre-analysis → LLM structured extraction → validation.
 * Heuristic remains the fallback / preprocessing path. Never fabricates
 * candidates when the model is down or JSON is invalid.
 */
export class LlmKnowledgeExtractionProvider implements KnowledgeExtractionProvider {
  readonly id = LLM_EXTRACTOR_VERSION;
  readonly usesModel = true;

  constructor(
    private readonly generate: KnowledgeExtractionGenerate | null,
    private readonly cache: KnowledgeExtractionCache = new InMemoryKnowledgeExtractionCache(),
    private readonly heuristic = new HeuristicKnowledgeExtractor(),
    private readonly budget: KnowledgeExtractionBudget = DEFAULT_KNOWLEDGE_EXTRACTION_BUDGET,
  ) {}

  async extractChunk(input: {
    originKind: KnowledgeOriginKind;
    title: string;
    chunkId: string;
    chunkText: string;
    chunkHash: string;
    chunkIndex: number | null;
    visibility: string;
    domainKeys?: string[];
    question?: string | null;
    answer?: string | null;
    containsPersonalConversation?: boolean;
    needsReasoning?: boolean;
  }): Promise<KnowledgeExtractionOutcome> {
    const filtered = filterConversationForOrganizationKnowledge({
      originKind: input.originKind,
      text: input.chunkText,
      visibility: input.visibility,
      containsPersonalConversation: input.containsPersonalConversation,
    });
    if (
      (input.originKind === "conversation" || input.originKind === "transcript") &&
      !filtered.allowOrganizationCandidate
    ) {
      return {
        status: "skipped_private",
        reason: filtered.reason,
        drafts: [],
      };
    }

    const text = filtered.sanitizedText.slice(0, this.budget.maxCharsPerExtraction);
    const pre = await this.heuristic.extract({
      originKind: input.originKind,
      title: input.title,
      text,
      chunkIndex: input.chunkIndex,
      question: input.question,
      answer: input.answer,
      domainKeys: input.domainKeys,
    });

    const connected = Boolean(this.generate);
    const modelIdHint = connected ? "fast" : "none";
    const cacheKey = extractionCacheKey({
      chunkHash: input.chunkHash || sha256Hex(text),
      extractorType: LLM_EXTRACTOR_TYPE,
      extractorVersion: LLM_EXTRACTOR_VERSION,
      modelId: modelIdHint,
      promptVersion: LLM_PROMPT_VERSION,
    });
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return {
        status: "extracted",
        drafts: cached.slice(0, this.budget.maxCandidatesPerChunk),
        extractorType: LLM_EXTRACTOR_TYPE,
        extractorVersion: LLM_EXTRACTOR_VERSION,
        modelRole: "fast",
        modelId: modelIdHint,
        promptVersion: LLM_PROMPT_VERSION,
        cached: true,
      };
    }

    if (!this.generate) {
      return {
        status: "waiting_for_extractor",
        reason: "extractor_unavailable",
        drafts: [],
      };
    }

    const isConversation =
      input.originKind === "conversation" || input.originKind === "transcript";
    const user = buildKnowledgeExtractionUserPrompt({
      originKind: input.originKind,
      title: input.title,
      chunkId: input.chunkId,
      chunkText: text,
      heuristicNotes: heuristicNotes(pre),
      domainKeys: input.domainKeys?.length ? input.domainKeys : ["company_common"],
      isConversation,
    });

    let lastInvalid = "schema_failed";
    const maxAttempts = Math.max(1, this.budget.maxRetries);
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const role: KnowledgeExtractionModelRole =
        input.needsReasoning && attempt === maxAttempts - 1 ? "reasoning" : attempt === 0 ? "fast" : "main";
      const generated = await this.generate({
        role,
        system: KNOWLEDGE_EXTRACTION_SYSTEM_POLICY,
        user,
        maxTokens: this.budget.maxTokensPerRequest,
        timeoutMs: this.budget.timeoutMs,
      });
      if (!generated.connected || !generated.text.trim()) {
        return {
          status: "waiting_for_extractor",
          reason: "extractor_unavailable",
          drafts: [],
        };
      }
      const parsed = parseStructuredExtraction(generated.text);
      if (!parsed.ok) {
        lastInvalid = parsed.detail;
        continue;
      }
      const drafts = toDrafts(
        parsed.value.candidates.slice(0, this.budget.maxCandidatesPerChunk),
        input.chunkIndex,
        input.originKind,
      ).map((d) => ({
        ...d,
        modelRole: generated.role,
        modelId: generated.modelId,
      }));
      const persistKey = extractionCacheKey({
        chunkHash: input.chunkHash || sha256Hex(text),
        extractorType: LLM_EXTRACTOR_TYPE,
        extractorVersion: LLM_EXTRACTOR_VERSION,
        modelId: generated.modelId,
        promptVersion: LLM_PROMPT_VERSION,
      });
      await this.cache.set(persistKey, drafts);
      await this.cache.set(cacheKey, drafts);
      return {
        status: "extracted",
        drafts,
        extractorType: LLM_EXTRACTOR_TYPE,
        extractorVersion: LLM_EXTRACTOR_VERSION,
        modelRole: generated.role,
        modelId: generated.modelId,
        promptVersion: LLM_PROMPT_VERSION,
        cached: false,
        usage: generated.usage,
        estimatedCostUsd: generated.estimatedCostUsd ?? null,
      };
    }

    return {
      status: "invalid",
      reason: lastInvalid,
      drafts: [],
    };
  }
}

export function createKnowledgeExtractionProvider(input: {
  generate: KnowledgeExtractionGenerate | null;
  cache?: KnowledgeExtractionCache;
}): KnowledgeExtractionProvider {
  return new LlmKnowledgeExtractionProvider(input.generate, input.cache);
}
