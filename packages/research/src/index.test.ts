import { describe, expect, it } from "vitest";
import {
  assertWithinBudget,
  createDisabledFirecrawlProvider,
  isWithinBudget,
  RESEARCH_PROGRESS_LABELS,
  ResearchProgressLabels,
} from "./index.js";

describe("research budget", () => {
  const budget = { maxTokens: 1000, maxSources: 5, maxFetches: 10 };

  it("allows usage within budget", () => {
    expect(
      isWithinBudget(budget, {
        tokensUsed: 500,
        sourcesUsed: 2,
        fetchesUsed: 3,
      }),
    ).toBe(true);
  });

  it("rejects over token budget", () => {
    expect(
      isWithinBudget(budget, {
        tokensUsed: 1001,
        sourcesUsed: 1,
        fetchesUsed: 1,
      }),
    ).toBe(false);
    expect(() =>
      assertWithinBudget(budget, {
        tokensUsed: 1001,
        sourcesUsed: 1,
        fetchesUsed: 1,
      }),
    ).toThrow("budget exceeded");
  });
});

describe("firecrawl disabled", () => {
  it("throws on scrape attempt", async () => {
    const provider = createDisabledFirecrawlProvider();
    expect(provider.config.enabled).toBe(false);
    await expect(provider.scrape("https://example.com")).rejects.toThrow(
      "disabled",
    );
  });
});

describe("research progress labels", () => {
  it("uses required Japanese user-facing labels", () => {
    expect(RESEARCH_PROGRESS_LABELS).toEqual([
      "検索しています",
      "候補を確認しています",
      "ページを読み取っています",
      "情報を整理しています",
      "回答を作成しています",
    ]);
    expect(Object.values(ResearchProgressLabels)).toEqual([
      ...RESEARCH_PROGRESS_LABELS,
    ]);
  });
});
