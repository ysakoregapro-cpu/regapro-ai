import {
  buildLlmContextSources,
  effectiveSearchCeiling,
  filterResourcesByAccess,
  type AccessContext,
} from "@regapro/security";
import type { ContextBuilder } from "./ports.js";
import type { AIContext, RetrievedItem } from "./types.js";

export class DefaultContextBuilder implements ContextBuilder {
  build(input: {
    access: AccessContext;
    items: RetrievedItem[];
    maxItems?: number;
    maxChars?: number;
  }): AIContext {
    const maxItems = input.maxItems ?? 12;
    const maxChars = input.maxChars ?? 12_000;
    const ceiling = effectiveSearchCeiling(input.access);

    // Belt-and-suspenders: filter again even if retrievers already filtered.
    const filtered = filterResourcesByAccess(
      input.access,
      input.items.map((i) => ({
        ...i,
        ownerUserId: i.ownerUserId ?? "",
      })),
    );

    const { allowed, rejectedIds } = buildLlmContextSources(
      input.access,
      filtered.map((i) => ({
        id: i.id,
        text: i.content,
        confidentialityLevel: i.confidentialityLevel,
        visibility: i.visibility,
      })),
    );

    const allowedIds = new Set(allowed.map((a) => a.id));
    const ranked = filtered
      .filter((i) => allowedIds.has(i.id))
      .sort((a, b) => b.relevance - a.relevance);

    const items = [];
    let chars = 0;
    for (const item of ranked) {
      if (items.length >= maxItems) break;
      if (chars + item.content.length > maxChars) break;
      // Never place audit-case material into AI context.
      if (item.sourceType === "conversation" && item.visibility === "private") {
        // Private conversations are excluded from normal knowledge retrieval.
        continue;
      }
      chars += item.content.length;
      items.push({
        id: item.id,
        content: item.content,
        source: item.title,
        sourceType: item.sourceType,
        confidentialityLevel: item.confidentialityLevel,
        freshness: item.freshness,
        relevance: item.relevance,
        citation: {
          id: `cite-${item.id}`,
          title: item.title,
          sourceType: item.sourceType,
          sourceId: item.sourceId,
          uri: item.sourceUri,
          excerpt: item.excerpt.slice(0, 240),
          confidentialityLevel: item.confidentialityLevel,
          relevance: item.relevance,
          provenance:
            item.sourceType === "web" || item.sourceType === "research"
              ? ("web" as const)
              : ("internal" as const),
          domain: item.domain ?? null,
          retrievedAt: item.retrievedAt ?? null,
          publishedAt: item.publishedAt ?? null,
        },
      });
    }

    return {
      items,
      ceiling,
      rejectedCount: rejectedIds.length,
      budgetHints: { maxItems, maxChars },
    };
  }
}
