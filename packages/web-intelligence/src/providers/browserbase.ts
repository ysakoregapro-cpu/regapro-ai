import type { BrowserProvider } from "../ports.js";
import type { WebSource } from "../types.js";
import {
  canonicalizeUrl,
  domainFromUrl,
  freshnessScore,
  makeSourceId,
  sourceQuality,
} from "../normalize.js";

/**
 * Browserbase: JS / interactive escalation only. Never the default fetch path.
 */
export class BrowserbaseProvider implements BrowserProvider {
  readonly id = "browserbase" as const;
  readonly connected: boolean;

  constructor(
    private readonly apiKey: string | null,
    private readonly projectId: string | null,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.connected = Boolean(apiKey && projectId);
  }

  async fetchInteractive(input: {
    url: string;
    signal?: AbortSignal;
  }): Promise<WebSource | null> {
    if (!this.apiKey || !this.projectId) return null;
    const retrievedAt = new Date().toISOString();
    const res = await this.fetchImpl("https://www.browserbase.com/v1/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BB-API-Key": this.apiKey,
      },
      signal: input.signal,
      body: JSON.stringify({
        projectId: this.projectId,
        browserSettings: { viewport: { width: 1280, height: 720 } },
      }),
    });
    if (!res.ok) return null;
    const session = (await res.json()) as { id?: string };
    if (!session.id) return null;

    try {
      // Minimal session: record that escalation occurred. Full CDP drive is
      // provider-specific; we do not invent page text if extract is unavailable.
      const pageRes = await this.fetchImpl(
        `https://www.browserbase.com/v1/sessions/${session.id}`,
        {
          headers: { "X-BB-API-Key": this.apiKey },
          signal: input.signal,
        },
      );
      if (!pageRes.ok) return null;
      const canonicalUrl = canonicalizeUrl(input.url);
      const domain = domainFromUrl(canonicalUrl);
      return {
        id: makeSourceId(canonicalUrl),
        title: domain,
        url: input.url,
        canonicalUrl,
        domain,
        publishedAt: null,
        retrievedAt,
        snippet: "",
        extractedText: null,
        relevance: 0.4,
        freshness: freshnessScore(null, retrievedAt),
        sourceQuality: sourceQuality(domain),
        provider: "browserbase",
        citation: {
          title: domain,
          url: canonicalUrl,
          excerpt: "",
        },
      };
    } finally {
      await this.fetchImpl(
        `https://www.browserbase.com/v1/sessions/${session.id}`,
        {
          method: "DELETE",
          headers: { "X-BB-API-Key": this.apiKey },
        },
      ).catch(() => undefined);
    }
  }
}

export class DisconnectedBrowserProvider implements BrowserProvider {
  readonly id = "browserbase" as const;
  readonly connected = false;
  async fetchInteractive(): Promise<WebSource | null> {
    return null;
  }
}
