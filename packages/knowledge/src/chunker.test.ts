import { describe, expect, it } from "vitest";
import {
  planChunkUpserts,
  splitKnowledgeBody,
} from "./chunker.js";
import { sha256Hex } from "./hash.js";
import { reciprocalRankFusion } from "./hybrid.js";
import {
  DisconnectedEmbeddingProvider,
  createDefaultEmbeddingProvider,
} from "./embedding.js";
import { eligibilityForKnowledgeDocument } from "./retrieval-eligibility.js";

describe("chunker", () => {
  const sample = [
    "# 営業マニュアル",
    "",
    "はじめに、顧客ヒアリングでは課題の言語化を優先します。",
    "",
    "## 手順",
    "",
    "第一に現状を確認します。第二に仮説を提示します。第三に合意形成を行います。",
    "",
    "補足として関係者レビューを必ず行います。".repeat(20),
  ].join("\n");

  it("is deterministic", () => {
    const a = splitKnowledgeBody(sample);
    const b = splitKnowledgeBody(sample);
    expect(a.map((c) => c.contentHash)).toEqual(b.map((c) => c.contentHash));
    expect(a.map((c) => c.chunkIndex)).toEqual(b.map((c) => c.chunkIndex));
  });

  it("prefers heading / paragraph boundaries and avoids tiny shards", () => {
    const chunks = splitKnowledgeBody(sample, { maxChars: 280, overlapChars: 40 });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.content.length > 0)).toBe(true);
    expect(chunks[0]?.content).toContain("営業マニュアル");
  });

  it("prevents infinite duplicates on re-ingest plan", () => {
    const drafts = splitKnowledgeBody(sample);
    const existing = drafts.map((d, i) => ({
      id: `id-${i}`,
      contentHash: d.contentHash,
      chunkIndex: d.chunkIndex,
    }));
    const plan = planChunkUpserts({ drafts, existing });
    expect(plan.toUpsert).toHaveLength(0);
    expect(plan.toSoftDeleteIds).toHaveLength(0);
    expect(plan.unchangedIds).toHaveLength(drafts.length);
  });

  it("soft-deletes removed hashes when content changes", () => {
    const drafts = splitKnowledgeBody("新しい本文だけです。");
    const existing = [
      { id: "old-1", contentHash: sha256Hex("古い"), chunkIndex: 0 },
    ];
    const plan = planChunkUpserts({ drafts, existing });
    expect(plan.toSoftDeleteIds).toEqual(["old-1"]);
    expect(plan.toUpsert.length).toBeGreaterThan(0);
  });
});

describe("hybrid RRF", () => {
  it("fuses ranks without raw score addition", () => {
    const fused = reciprocalRankFusion({
      lexical: [
        { id: "a", rank: 1, title: "A" },
        { id: "b", rank: 2, title: "B" },
      ],
      vector: [
        { id: "b", rank: 1, title: "B" },
        { id: "c", rank: 2, title: "C" },
      ],
      k: 60,
    });
    expect(fused[0]?.id).toBe("b");
    expect(fused[0]?.lexicalRank).toBe(2);
    expect(fused[0]?.vectorRank).toBe(1);
    expect(fused[0]?.finalRank).toBe(1);
  });
});

describe("embedding provider", () => {
  it("defaults to disconnected and refuses fake vectors", async () => {
    const p = createDefaultEmbeddingProvider();
    expect(p.available).toBe(false);
    await expect(p.embedQuery("x")).rejects.toThrow(/DISCONNECTED/);
    const d = new DisconnectedEmbeddingProvider();
    await expect(d.embedDocuments(["a"])).rejects.toThrow(/DISCONNECTED/);
  });
});

describe("retrieval eligibility", () => {
  it("allows only published non-private non-conversation knowledge", () => {
    expect(
      eligibilityForKnowledgeDocument({
        status: "published",
        containsPersonalConversation: false,
        visibility: "organization",
      }),
    ).toBe("organization_retrieval");
    expect(
      eligibilityForKnowledgeDocument({
        status: "approved",
        containsPersonalConversation: false,
        visibility: "organization",
      }),
    ).toBe("review_queue_only");
    expect(
      eligibilityForKnowledgeDocument({
        status: "published",
        containsPersonalConversation: true,
        visibility: "organization",
      }),
    ).toBe("excluded");
    expect(
      eligibilityForKnowledgeDocument({
        status: "published",
        containsPersonalConversation: false,
        visibility: "private",
      }),
    ).toBe("private_memory_only");
  });
});
