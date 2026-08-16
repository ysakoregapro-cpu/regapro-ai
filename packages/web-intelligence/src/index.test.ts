import { describe, expect, it } from "vitest";
import { canonicalizeUrl, dedupeSources } from "./normalize.js";
import { sanitizeExternalQuery } from "./sanitize.js";
import { DefaultWebResearchProvider } from "./orchestrator.js";
import { DisconnectedBrowserProvider } from "./providers/browserbase.js";
import { DisconnectedContentProvider } from "./providers/firecrawl.js";
import type { WebSearchProvider } from "./ports.js";
import type { WebSource } from "./types.js";
import { DEFAULT_WEB_BUDGET } from "./types.js";

describe("sanitizeExternalQuery", () => {
  it("does not send private salary/person details to the web", () => {
    const plan = sanitizeExternalQuery({
      request:
        "田中さんが年収800万でこういう問題を抱えている。この人に向く求人を探して。Java 東京 SES",
      confidentialityLevel: "people",
    });
    expect(plan.removedSensitiveSignals).toContain("person_name");
    expect(plan.removedSensitiveSignals).toContain("compensation");
    for (const q of plan.sanitizedQueries) {
      expect(q).not.toMatch(/田中/);
      expect(q).not.toMatch(/800/);
      expect(q).not.toMatch(/問題/);
    }
    expect(plan.sanitizedQueries.some((q) => /求人/.test(q))).toBe(true);
  });

  it("does not hijack 人材市場 into compensation queries", () => {
    const plan = sanitizeExternalQuery({
      request:
        "レガプロの通信事業について、現在の通信販売・人材市場の外部環境を分けて調査し根拠を付けて",
      confidentialityLevel: "company",
    });
    expect(plan.removedSensitiveSignals).not.toContain("compensation");
    expect(plan.sanitizedQueries.some((q) => /年収/.test(q))).toBe(false);
    expect(plan.sanitizedQueries.some((q) => /人材市場|通信/.test(q))).toBe(
      true,
    );
    expect(plan.externalTransmissionAllowed).toBe(true);
  });

  it("does not leak L2/L3 person names into external queries", () => {
    const plan = sanitizeExternalQuery({
      request: "酒匂さんの未公開評価と年収800万を市場と比較して",
      confidentialityLevel: "people",
    });
    for (const q of plan.sanitizedQueries) {
      expect(q).not.toMatch(/酒匂/);
      expect(q).not.toMatch(/800/);
      expect(q).not.toMatch(/未公開評価/);
    }
  });

  it("blocks PII from transmission", () => {
    const plan = sanitizeExternalQuery({
      request: "候補者のメールアドレス test@example.com で調べて",
      confidentialityLevel: "company",
    });
    expect(plan.externalTransmissionAllowed).toBe(false);
  });
});

describe("canonicalizeUrl", () => {
  it("strips tracking params and duplicates", () => {
    const a = canonicalizeUrl("https://WWW.Example.com/a/?utm_source=x");
    const b = canonicalizeUrl("https://www.example.com/a");
    expect(a).toBe(b);
    const sources = [
      fake("https://example.com/a?utm_campaign=1"),
      fake("https://example.com/a"),
    ];
    expect(dedupeSources(sources)).toHaveLength(1);
  });
});

describe("orchestrator", () => {
  it("returns empty when search is disconnected — no fake hits", async () => {
    const p = new DefaultWebResearchProvider({
      search: { id: "tavily", connected: false, async search() { return []; } },
      content: new DisconnectedContentProvider(),
      browser: new DisconnectedBrowserProvider(),
    });
    const out = await p.research({
      plan: {
        originalRequest: "通信市場",
        sanitizedQueries: ["通信市場"],
        removedSensitiveSignals: [],
        requiresConfirmation: false,
        confidentialityLevel: "company",
        externalTransmissionAllowed: true,
      },
      confidentialityLevel: "company",
      budget: DEFAULT_WEB_BUDGET,
      needPageBodies: false,
      allowBrowserEscalation: false,
    });
    expect(out.sources).toEqual([]);
    expect(out.limitations.length).toBeGreaterThan(0);
  });

  it("uses search results and does not invent citations", async () => {
    const search: WebSearchProvider = {
      id: "tavily",
      connected: true,
      async search() {
        return [fake("https://example.com/telecom")];
      },
    };
    const p = new DefaultWebResearchProvider({
      search,
      content: new DisconnectedContentProvider(),
      browser: new DisconnectedBrowserProvider(),
    });
    const out = await p.research({
      plan: {
        originalRequest: "通信市場",
        sanitizedQueries: ["通信市場"],
        removedSensitiveSignals: [],
        requiresConfirmation: false,
        confidentialityLevel: "company",
        externalTransmissionAllowed: true,
      },
      confidentialityLevel: "company",
      budget: { ...DEFAULT_WEB_BUDGET, maxQueries: 2, maxResults: 5 },
      needPageBodies: false,
      allowBrowserEscalation: false,
    });
    expect(out.sources).toHaveLength(1);
    expect(out.sources[0]?.canonicalUrl).toContain("example.com");
  });
});

function fake(url: string): WebSource {
  return {
    id: url,
    title: "t",
    url,
    canonicalUrl: url,
    domain: "example.com",
    publishedAt: null,
    retrievedAt: new Date().toISOString(),
    snippet: "s",
    extractedText: null,
    relevance: 0.8,
    freshness: 0.5,
    sourceQuality: 0.5,
    provider: "tavily",
    citation: { title: "t", url, excerpt: "s" },
  };
}
