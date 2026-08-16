import type { WebContentProvider } from "../ports.js";
import type { WebSource } from "../types.js";
import {
  canonicalizeUrl,
  domainFromUrl,
  freshnessScore,
  makeSourceId,
  sourceQuality,
} from "../normalize.js";

/**
 * Firecrawl: page fetch / scrape. Not used as the default search engine.
 */
export class FirecrawlContentProvider implements WebContentProvider {
  readonly id = "firecrawl" as const;
  readonly connected: boolean;

  constructor(
    private readonly apiKey: string | null,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.connected = Boolean(apiKey);
  }

  async fetchPage(input: {
    url: string;
    signal?: AbortSignal;
  }): Promise<WebSource | null> {
    if (!this.apiKey) return null;
    const retrievedAt = new Date().toISOString();
    const res = await this.fetchImpl("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      signal: input.signal,
      body: JSON.stringify({
        url: input.url,
        formats: ["markdown"],
        onlyMainContent: true,
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      success?: boolean;
      data?: { markdown?: string; metadata?: { title?: string; sourceURL?: string } };
    };
    const markdown = json.data?.markdown?.trim();
    if (!markdown) return null;
    const url = json.data?.metadata?.sourceURL ?? input.url;
    const canonicalUrl = canonicalizeUrl(url);
    const domain = domainFromUrl(canonicalUrl);
    const title = json.data?.metadata?.title ?? domain;
    return {
      id: makeSourceId(canonicalUrl),
      title: title.slice(0, 300),
      url,
      canonicalUrl,
      domain,
      publishedAt: null,
      retrievedAt,
      snippet: markdown.slice(0, 500),
      extractedText: markdown.slice(0, 12_000),
      relevance: 0.7,
      freshness: freshnessScore(null, retrievedAt),
      sourceQuality: sourceQuality(domain),
      provider: "firecrawl",
      citation: {
        title: title.slice(0, 300),
        url: canonicalUrl,
        excerpt: markdown.slice(0, 240),
      },
    };
  }
}

export class DisconnectedContentProvider implements WebContentProvider {
  readonly id = "firecrawl" as const;
  readonly connected = false;
  async fetchPage(): Promise<WebSource | null> {
    return null;
  }
}
