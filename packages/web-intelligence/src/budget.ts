import type { WebIntelligenceBudget } from "./types.js";
import { DEFAULT_WEB_BUDGET } from "./types.js";

export class WebBudgetGuard {
  private queries = 0;
  private results = 0;
  private pages = 0;
  private browsers = 0;
  private started = Date.now();

  constructor(private readonly budget: WebIntelligenceBudget = DEFAULT_WEB_BUDGET) {}

  remainingMs(): number {
    return Math.max(0, this.budget.timeoutMs - (Date.now() - this.started));
  }

  assertTime(): void {
    if (this.remainingMs() <= 0) throw new Error("WEB_BUDGET_TIMEOUT");
  }

  takeQuery(): boolean {
    if (this.remainingMs() <= 0) return false;
    if (this.queries >= this.budget.maxQueries) return false;
    this.queries += 1;
    return true;
  }

  takeResults(n: number): number {
    const room = this.budget.maxResults - this.results;
    const take = Math.max(0, Math.min(n, room));
    this.results += take;
    return take;
  }

  takePage(): boolean {
    if (this.remainingMs() <= 0) return false;
    if (this.pages >= this.budget.maxFetchedPages) return false;
    this.pages += 1;
    return true;
  }

  takeBrowser(): boolean {
    if (this.remainingMs() <= 0) return false;
    if (this.browsers >= this.budget.maxBrowserSessions) return false;
    this.browsers += 1;
    return true;
  }

  snapshot() {
    return {
      queries: this.queries,
      results: this.results,
      pages: this.pages,
      browsers: this.browsers,
    };
  }
}
