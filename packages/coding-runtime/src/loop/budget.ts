import type { CodingBudget } from "../types.js";
import { DEFAULT_CODING_BUDGET } from "../types.js";

export class CodingBudgetGuard {
  readonly limits: CodingBudget;
  iterations = 0;
  toolCalls = 0;
  estimatedCostUsd = 0;
  private readonly started = Date.now();

  constructor(partial?: Partial<CodingBudget>) {
    this.limits = { ...DEFAULT_CODING_BUDGET, ...partial };
  }

  elapsedMs(): number {
    return Date.now() - this.started;
  }

  takeIteration(): boolean {
    if (this.iterations >= this.limits.maxIterations) return false;
    if (this.elapsedMs() >= this.limits.maxMillis) return false;
    if (this.estimatedCostUsd >= this.limits.maxCostUsd) return false;
    this.iterations += 1;
    return true;
  }

  takeToolCall(): boolean {
    if (this.toolCalls >= this.limits.maxToolCalls) return false;
    if (this.elapsedMs() >= this.limits.maxMillis) return false;
    this.toolCalls += 1;
    return true;
  }

  addCost(usd: number | null | undefined): void {
    if (typeof usd === "number" && Number.isFinite(usd)) {
      this.estimatedCostUsd += usd;
    }
  }

  exhaustedReason(): string | null {
    if (this.iterations >= this.limits.maxIterations) return "max_iterations";
    if (this.toolCalls >= this.limits.maxToolCalls) return "max_tool_calls";
    if (this.elapsedMs() >= this.limits.maxMillis) return "max_time";
    if (this.estimatedCostUsd >= this.limits.maxCostUsd) return "max_cost";
    return null;
  }
}
