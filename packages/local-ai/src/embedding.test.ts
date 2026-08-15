import { describe, expect, it } from "vitest";
import { DisconnectedEmbeddingProvider } from "@regapro/knowledge";
import { ACTIVE_EMBEDDING_MANIFEST } from "./embedding-manifest.js";
import { createEmbeddingProvider } from "./embedding-factory.js";
import {
  resolveEmbeddingRuntimeMode,
  TransformersJsEmbeddingProvider,
} from "./transformers-embedding.js";

describe("embedding manifest", () => {
  it("pins multilingual-e5-small at 384 — not provisional 1536", () => {
    expect(ACTIVE_EMBEDDING_MANIFEST.dimensions).toBe(384);
    expect(ACTIVE_EMBEDDING_MANIFEST.dimensions).not.toBe(1536);
    expect(ACTIVE_EMBEDDING_MANIFEST.multilingual).toBe(true);
    expect(ACTIVE_EMBEDDING_MANIFEST.queryPrefix).toBe("query: ");
    expect(ACTIVE_EMBEDDING_MANIFEST.documentPrefix).toBe("passage: ");
  });
});

describe("embedding factory", () => {
  it("returns disconnected when runtime=disconnected", () => {
    const p = createEmbeddingProvider({
      REGAPRO_EMBEDDING_RUNTIME: "disconnected",
    });
    expect(p).toBeInstanceOf(DisconnectedEmbeddingProvider);
    expect(p.available).toBe(false);
  });

  it("returns transformers provider when enabled", () => {
    const p = createEmbeddingProvider({
      REGAPRO_EMBEDDING_RUNTIME: "transformers",
    });
    expect(p).toBeInstanceOf(TransformersJsEmbeddingProvider);
    expect(p.available).toBe(true);
    expect(p.dimensions).toBe(384);
  });

  it("resolves mode defaults to transformers", () => {
    expect(resolveEmbeddingRuntimeMode({})).toBe("transformers");
    expect(resolveEmbeddingRuntimeMode({ REGAPRO_EMBEDDING_RUNTIME: "off" })).toBe(
      "disconnected",
    );
  });
});

describe("TransformersJsEmbeddingProvider (optional smoke)", () => {
  it("embeds query/document when REGAPRO_EMBEDDING_SMOKE=1", async () => {
    if (process.env.REGAPRO_EMBEDDING_SMOKE !== "1") {
      return;
    }
    const p = new TransformersJsEmbeddingProvider();
    const q = await p.embedQuery("就業規則の始業時刻");
    const d = await p.embedDocuments(["就業規則では始業は午前九時です。"]);
    expect(q.dimensions).toBe(384);
    expect(q.values).toHaveLength(384);
    expect(d[0]?.values).toHaveLength(384);
    expect(q.values.some((v) => v !== 0)).toBe(true);
  }, 300_000);
});
