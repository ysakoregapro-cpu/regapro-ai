import { z } from "zod";

export const RESEARCH_STAGES = [
  "search",
  "review_candidates",
  "read_pages",
  "organize",
  "compose_answer",
] as const;

export type ResearchStage = (typeof RESEARCH_STAGES)[number];

/** User-facing progress labels (no technical jargon). */
export const ResearchProgressLabels: Record<ResearchStage, string> = {
  search: "検索しています",
  review_candidates: "候補を確認しています",
  read_pages: "ページを読み取っています",
  organize: "情報を整理しています",
  compose_answer: "回答を作成しています",
};

export const RESEARCH_PROGRESS_LABELS = [
  "検索しています",
  "候補を確認しています",
  "ページを読み取っています",
  "情報を整理しています",
  "回答を作成しています",
] as const;

export const ResearchBudgetSchema = z.object({
  maxTokens: z.number().int().positive(),
  maxSources: z.number().int().positive(),
  maxFetches: z.number().int().positive(),
});

export type ResearchBudget = z.infer<typeof ResearchBudgetSchema>;

export interface BudgetUsage {
  tokensUsed: number;
  sourcesUsed: number;
  fetchesUsed: number;
}

export function isWithinBudget(
  budget: ResearchBudget,
  usage: BudgetUsage,
): boolean {
  return (
    usage.tokensUsed <= budget.maxTokens &&
    usage.sourcesUsed <= budget.maxSources &&
    usage.fetchesUsed <= budget.maxFetches
  );
}

export function assertWithinBudget(
  budget: ResearchBudget,
  usage: BudgetUsage,
): void {
  if (!isWithinBudget(budget, usage)) {
    throw new Error("Research budget exceeded");
  }
}

export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
}

export interface SearchProvider {
  readonly name: string;
  search(query: string, limit?: number): Promise<SearchResult[]>;
}

export interface FetchResult {
  url: string;
  status: number;
  contentType: string;
  body: string;
}

export interface FetchProvider {
  readonly name: string;
  fetch(url: string): Promise<FetchResult>;
}

export interface CrawlProvider {
  readonly name: string;
  crawl(url: string, depth?: number): Promise<FetchResult[]>;
}

export interface FirecrawlConfig {
  enabled: false;
  apiKey?: never;
}

export interface FirecrawlProvider {
  readonly name: "firecrawl";
  readonly config: FirecrawlConfig;
  scrape(_url: string): Promise<never>;
}

export function createDisabledFirecrawlProvider(): FirecrawlProvider {
  return {
    name: "firecrawl",
    config: { enabled: false },
    async scrape(): Promise<never> {
      throw new Error("Firecrawl is disabled; no HTTP calls are permitted");
    },
  };
}

export class SearXNGSearchProvider implements SearchProvider {
  readonly name = "searxng";

  async search(_query: string, _limit = 10): Promise<SearchResult[]> {
    return [];
  }
}

export class HttpFetchProvider implements FetchProvider {
  readonly name = "http-fetch";

  async fetch(url: string): Promise<FetchResult> {
    return {
      url,
      status: 0,
      contentType: "text/plain",
      body: "",
    };
  }
}

export class CrawleeProvider implements CrawlProvider {
  readonly name = "crawlee";

  async crawl(url: string, _depth = 1): Promise<FetchResult[]> {
    return [
      {
        url,
        status: 0,
        contentType: "text/plain",
        body: "",
      },
    ];
  }
}

export class PlaywrightFetchProvider implements FetchProvider {
  readonly name = "playwright";

  async fetch(url: string): Promise<FetchResult> {
    return {
      url,
      status: 0,
      contentType: "text/html",
      body: "<!-- playwright stub -->",
    };
  }
}

export class TavilyFallbackProvider implements SearchProvider {
  readonly name = "tavily";

  async search(_query: string, _limit = 10): Promise<SearchResult[]> {
    return [];
  }
}

export class ExaProvider implements SearchProvider {
  readonly name = "exa";

  async search(_query: string, _limit = 10): Promise<SearchResult[]> {
    return [];
  }
}

export function nextStage(current: ResearchStage): ResearchStage | null {
  const idx = RESEARCH_STAGES.indexOf(current);
  return idx >= 0 && idx < RESEARCH_STAGES.length - 1
    ? RESEARCH_STAGES[idx + 1]!
    : null;
}
