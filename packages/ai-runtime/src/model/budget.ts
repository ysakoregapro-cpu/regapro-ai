export type RuntimeBudget = {
  maxLlmCalls: number;
  maxTokens: number;
  maxReasoningRetries: number;
  timeoutMs: number;
  maxRecursion: number;
};

export const DEFAULT_RUNTIME_BUDGET: RuntimeBudget = {
  maxLlmCalls: 4,
  maxTokens: 16_000,
  maxReasoningRetries: 1,
  timeoutMs: 45_000,
  maxRecursion: 2,
};

export class RuntimeBudgetGuard {
  private llmCalls = 0;
  private tokens = 0;
  private reasoningRetries = 0;
  private recursion = 0;
  private readonly started = Date.now();

  constructor(private readonly budget: RuntimeBudget = DEFAULT_RUNTIME_BUDGET) {}

  remainingMs(): number {
    return Math.max(0, this.budget.timeoutMs - (Date.now() - this.started));
  }

  assertTime(): void {
    if (this.remainingMs() <= 0) throw new Error("RUNTIME_BUDGET_TIMEOUT");
  }

  takeLlmCall(): boolean {
    this.assertTime();
    if (this.llmCalls >= this.budget.maxLlmCalls) return false;
    this.llmCalls += 1;
    return true;
  }

  takeReasoningRetry(): boolean {
    if (this.reasoningRetries >= this.budget.maxReasoningRetries) return false;
    this.reasoningRetries += 1;
    return this.takeLlmCall();
  }

  takeRecursion(): boolean {
    if (this.recursion >= this.budget.maxRecursion) return false;
    this.recursion += 1;
    return true;
  }

  addTokens(n: number): void {
    this.tokens += Math.max(0, n);
    if (this.tokens > this.budget.maxTokens) {
      throw new Error("RUNTIME_BUDGET_TOKENS");
    }
  }

  snapshot() {
    return {
      llmCalls: this.llmCalls,
      tokens: this.tokens,
      reasoningRetries: this.reasoningRetries,
      recursion: this.recursion,
      remainingMs: this.remainingMs(),
    };
  }
}

const processUsage = {
  llmCalls: 0,
  tokens: 0,
  estimatedCostUsd: 0,
  failures: 0,
};

export function recordProcessUsage(input: {
  llmCalls?: number;
  tokens?: number;
  estimatedCostUsd?: number | null;
  failed?: boolean;
}): void {
  processUsage.llmCalls += input.llmCalls ?? 0;
  processUsage.tokens += input.tokens ?? 0;
  processUsage.estimatedCostUsd += input.estimatedCostUsd ?? 0;
  if (input.failed) processUsage.failures += 1;
}

export function getProcessUsageSnapshot() {
  return { ...processUsage };
}
