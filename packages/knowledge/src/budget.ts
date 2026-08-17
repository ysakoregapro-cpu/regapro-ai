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

export const DEFAULT_KNOWLEDGE_INGESTION_BUDGET: KnowledgeIngestionBudget = {
  maxCharsPerSourceChunk: 1800,
  overlapChars: 160,
  minChars: 80,
  maxUnitsPerTick: 8,
  maxModelCallsPerJob: 40,
  maxTokensPerJob: 80_000,
  timeoutMs: 45_000,
  maxRetries: 3,
};

export class KnowledgeIngestionBudgetGuard {
  private modelCalls = 0;
  private tokens = 0;
  private readonly started = Date.now();

  constructor(
    private readonly budget: KnowledgeIngestionBudget = DEFAULT_KNOWLEDGE_INGESTION_BUDGET,
  ) {}

  remainingMs(): number {
    return Math.max(0, this.budget.timeoutMs - (Date.now() - this.started));
  }

  takeUnitTick(processedThisTick: number): boolean {
    return processedThisTick < this.budget.maxUnitsPerTick && this.remainingMs() > 0;
  }

  takeModelCall(estimatedTokens = 0): boolean {
    if (this.remainingMs() <= 0) return false;
    if (this.modelCalls >= this.budget.maxModelCallsPerJob) return false;
    if (this.tokens + estimatedTokens > this.budget.maxTokensPerJob) return false;
    this.modelCalls += 1;
    this.tokens += Math.max(0, estimatedTokens);
    return true;
  }

  snapshot() {
    return {
      modelCalls: this.modelCalls,
      tokens: this.tokens,
      remainingMs: this.remainingMs(),
      maxUnitsPerTick: this.budget.maxUnitsPerTick,
    };
  }
}
