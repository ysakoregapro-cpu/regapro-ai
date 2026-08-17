export type KnowledgeIngestionBudget = {
  maxCharsPerSourceChunk: number;
  overlapChars: number;
  minChars: number;
  maxUnitsPerTick: number;
  maxModelCallsPerJob: number;
  maxTokensPerJob: number;
  timeoutMs: number;
  maxRetries: number;
};

export type KnowledgeExtractionBudget = {
  maxCharsPerExtraction: number;
  maxTokensPerRequest: number;
  maxCandidatesPerChunk: number;
  maxRetries: number;
  maxReasoningEscalations: number;
  timeoutMs: number;
  maxConcurrentExtractionJobs: number;
  estimatedCostUsdCeiling: number;
  leaseSeconds: number;
};

export const DEFAULT_KNOWLEDGE_INGESTION_BUDGET: KnowledgeIngestionBudget = {
  maxCharsPerSourceChunk: 4000,
  overlapChars: 160,
  minChars: 80,
  maxUnitsPerTick: 8,
  maxModelCallsPerJob: 40,
  maxTokensPerJob: 80_000,
  timeoutMs: 45_000,
  maxRetries: 3,
};

export const DEFAULT_KNOWLEDGE_EXTRACTION_BUDGET: KnowledgeExtractionBudget = {
  maxCharsPerExtraction: 6_000,
  maxTokensPerRequest: 4_000,
  maxCandidatesPerChunk: 4,
  maxRetries: 2,
  maxReasoningEscalations: 2,
  timeoutMs: 25_000,
  maxConcurrentExtractionJobs: 2,
  estimatedCostUsdCeiling: 5,
  leaseSeconds: 90,
};

export class KnowledgeIngestionBudgetGuard {
  private modelCalls = 0;
  private tokens = 0;
  private estimatedCostUsd = 0;
  private reasoningEscalations = 0;
  private readonly started = Date.now();

  constructor(
    private readonly budget: KnowledgeIngestionBudget = DEFAULT_KNOWLEDGE_INGESTION_BUDGET,
    private readonly extraction: KnowledgeExtractionBudget = DEFAULT_KNOWLEDGE_EXTRACTION_BUDGET,
  ) {}

  remainingMs(): number {
    return Math.max(0, this.budget.timeoutMs - (Date.now() - this.started));
  }

  takeUnitTick(processedThisTick: number): boolean {
    return processedThisTick < this.budget.maxUnitsPerTick && this.remainingMs() > 0;
  }

  takeModelCall(estimatedTokens = 0, estimatedCostUsd = 0): boolean {
    if (this.remainingMs() <= 0) return false;
    if (this.modelCalls >= this.budget.maxModelCallsPerJob) return false;
    if (this.tokens + estimatedTokens > this.budget.maxTokensPerJob) return false;
    if (this.estimatedCostUsd + estimatedCostUsd > this.extraction.estimatedCostUsdCeiling) {
      return false;
    }
    this.modelCalls += 1;
    this.tokens += Math.max(0, estimatedTokens);
    this.estimatedCostUsd += Math.max(0, estimatedCostUsd);
    return true;
  }

  takeReasoningEscalation(): boolean {
    if (this.reasoningEscalations >= this.extraction.maxReasoningEscalations) return false;
    this.reasoningEscalations += 1;
    return true;
  }

  snapshot() {
    return {
      modelCalls: this.modelCalls,
      tokens: this.tokens,
      estimatedCostUsd: this.estimatedCostUsd,
      reasoningEscalations: this.reasoningEscalations,
      remainingMs: this.remainingMs(),
      maxUnitsPerTick: this.budget.maxUnitsPerTick,
    };
  }
}

export function estimateExtractionCostUsd(input: {
  promptTokens: number;
  completionTokens: number;
  inputPerMillionUsd?: number | null;
  outputPerMillionUsd?: number | null;
}): number {
  const inRate = input.inputPerMillionUsd ?? 0.4;
  const outRate = input.outputPerMillionUsd ?? 1.6;
  return (
    (input.promptTokens / 1_000_000) * inRate +
    (input.completionTokens / 1_000_000) * outRate
  );
}
