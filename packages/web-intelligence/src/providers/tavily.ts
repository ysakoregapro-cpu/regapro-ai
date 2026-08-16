import type { WebSearchProvider } from "../ports.js";
import type { WebSource } from "../types.js";
import {
  canonicalizeUrl,
  domainFromUrl,
  freshnessScore,
  makeSourceId,
  sourceQuality,
} from "../normalize.js";

type TavilyHit = {
  title?: string;
  url?: string;
  content?: string;
  published_date?: string;
  score?: number;
};

/**
 * Tavily is the primary web search/research provider.
 * Returns [] when disconnected — never fabricates hits.
 */
export class TavilySearchProvider implements WebSearchProvider {
  readonly id = "tavily" as const;
  readonly connected: boolean;

  constructor(
    private readonly apiKey: string | null,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.connected = Boolean(apiKey);
  }

  async search(input: {
    query: string;
    limit: number;
    signal?: AbortSignal;
  }): Promise<WebSource[]> {
    if (!this.apiKey) return [];
    const retrievedAt = new Date().toISOString();
    const res = await this.fetchImpl("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: input.signal,
      body: JSON.stringify({
        api_key: this.apiKey,
        query: input.query,
        max_results: Math.min(input.limit, 10),
        search_depth: "basic",
        include_answer: false,
      }),
    });
    if (!res.ok) {
      throw new Error(`TAVILY_HTTP_${res.status}`);
    }
    const json = (await res.json()) as { results?: TavilyHit[] };
    const hits = json.results ?? [];
    return hits
      .filter((h) => typeof h.url === "string" && h.url.startsWith("http"))
      .map((h) => {
        const url = h.url!;
        const canonicalUrl = canonicalizeUrl(url);
        const domain = domainFromUrl(canonicalUrl);
        const snippet = (h.content ?? h.title ?? "").slice(0, 500);
        return {
          id: makeSourceId(canonicalUrl),
          title: (h.title ?? domain).slice(0, 300),
          url,
          canonicalUrl,
          domain,
          publishedAt: h.published_date ?? null,
          retrievedAt,
          snippet,
          extractedText: null,
          relevance: typeof h.score === "number" ? Math.min(1, h.score) : 0.5,
          freshness: freshnessScore(h.published_date ?? null, retrievedAt),
          sourceQuality: sourceQuality(domain),
          provider: "tavily" as const,
          citation: {
            title: (h.title ?? domain).slice(0, 300),
            url: canonicalUrl,
            excerpt: snippet.slice(0, 240),
          },
        };
      });
  }
}

export class DisconnectedSearchProvider implements WebSearchProvider {
  readonly id: "tavily" | "exa";
  readonly connected = false;
  constructor(id: "tavily" | "exa" = "tavily") {
    this.id = id;
  }
  async search(): Promise<WebSource[]> {
    return [];
  }
}
