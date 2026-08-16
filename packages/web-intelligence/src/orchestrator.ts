import type { ConfidentialityLevel } from "@regapro/shared";
import { WebBudgetGuard } from "./budget.js";
import { expandSanitizedQueries } from "./decompose.js";
import { dedupeSources, rankSources } from "./normalize.js";
import type { WebIntelligenceDeps, WebResearchProvider } from "./ports.js";
import type {
  ResearchEvidence,
  SanitizedQueryPlan,
  WebIntelligenceBudget,
  WebProviderId,
  WebResearchResult,
  WebSource,
} from "./types.js";

function abortAfter(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

/**
 * Search → optional Firecrawl fetch → Browserbase only as last escalation.
 * LLM is never asked to "search the web" itself.
 */
export class DefaultWebResearchProvider implements WebResearchProvider {
  readonly id = "web-intelligence";
  readonly connected: boolean;

  constructor(private readonly deps: WebIntelligenceDeps) {
    this.connected = deps.search.connected;
  }

  async research(input: {
    plan: SanitizedQueryPlan;
    confidentialityLevel: ConfidentialityLevel;
    budget: WebIntelligenceBudget;
    needPageBodies: boolean;
    allowBrowserEscalation: boolean;
  }): Promise<WebResearchResult> {
    void input.confidentialityLevel;
    const limitations: string[] = [];
    const providerPath: WebProviderId[] = [];
    const guard = new WebBudgetGuard(input.budget);
    const signal = abortAfter(input.budget.timeoutMs);

    if (!input.plan.externalTransmissionAllowed) {
      return {
        sources: [],
        evidence: [],
        queriesUsed: [],
        pagesFetched: 0,
        browserSessions: 0,
        providerPath,
        limitations: ["外部送信が許可されないため Web 検索は実行していません。"],
      };
    }
    if (!this.deps.search.connected) {
      return {
        sources: [],
        evidence: [],
        queriesUsed: [],
        pagesFetched: 0,
        browserSessions: 0,
        providerPath,
        limitations: ["Web検索は未接続です。"],
      };
    }

    const collected: WebSource[] = [];
    const queriesUsed: string[] = [];
    const queries = expandSanitizedQueries(input.plan, input.budget.maxQueries);

    for (const q of queries) {
      if (!guard.takeQuery()) break;
      queriesUsed.push(q);
      try {
        const hits = await this.deps.search.search({
          query: q,
          limit: input.budget.maxResults,
          signal,
        });
        providerPath.push(this.deps.search.id);
        const room = guard.takeResults(hits.length);
        collected.push(...hits.slice(0, room));
      } catch {
        limitations.push("検索プロバイダの一部呼び出しに失敗しました。");
      }
    }

    let ranked = rankSources(dedupeSources(collected)).slice(
      0,
      input.budget.maxResults,
    );

    let pagesFetched = 0;
    let browserSessions = 0;

    if (input.needPageBodies && this.deps.content.connected) {
      const enriched: WebSource[] = [];
      for (const src of ranked) {
        if (!guard.takePage()) break;
        try {
          const page = await this.deps.content.fetchPage({
            url: src.canonicalUrl,
            signal,
          });
          pagesFetched += 1;
          providerPath.push("firecrawl");
          if (page?.extractedText) {
            enriched.push({
              ...src,
              extractedText: page.extractedText,
              snippet: page.snippet || src.snippet,
              title: page.title || src.title,
            });
          } else if (
            input.allowBrowserEscalation &&
            this.deps.browser.connected &&
            guard.takeBrowser()
          ) {
            const interactive = await this.deps.browser.fetchInteractive({
              url: src.canonicalUrl,
              signal,
            });
            browserSessions += 1;
            providerPath.push("browserbase");
            enriched.push(interactive?.extractedText ? { ...src, ...interactive } : src);
          } else {
            enriched.push(src);
          }
        } catch {
          enriched.push(src);
        }
      }
      ranked = rankSources(dedupeSources(enriched));
    } else if (input.needPageBodies && !this.deps.content.connected) {
      limitations.push("ページ本文取得は未接続のため、検索スニペットのみです。");
    }

    let chars = 0;
    const clipped: WebSource[] = [];
    for (const s of ranked) {
      const add = (s.extractedText ?? s.snippet).length;
      if (chars + add > input.budget.maxContextChars) break;
      chars += add;
      clipped.push(s);
    }

    const evidence: ResearchEvidence[] = clipped.slice(0, 6).map((s, i) => ({
      id: `ev-${s.id}-${i}`,
      claim: s.snippet.slice(0, 200),
      sources: [s],
      confidence: Math.min(1, s.relevance * s.sourceQuality),
      groupedTopic: s.domain,
    }));

    return {
      sources: clipped,
      evidence,
      queriesUsed,
      pagesFetched,
      browserSessions,
      providerPath: [...new Set(providerPath)],
      limitations,
    };
  }
}

export function createDisconnectedWebResearchResult(): WebResearchResult {
  return {
    sources: [],
    evidence: [],
    queriesUsed: [],
    pagesFetched: 0,
    browserSessions: 0,
    providerPath: [],
    limitations: ["Web検索は未接続です。"],
  };
}
