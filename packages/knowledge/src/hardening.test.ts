import { describe, expect, it } from "vitest";
import {
  DEFAULT_KNOWLEDGE_EXTRACTION_BUDGET,
  InMemoryKnowledgeExtractionCache,
  InMemoryKnowledgeJobQueue,
  LlmKnowledgeExtractionProvider,
  canBatchApprove,
  classifyKnowledgeConflict,
  extractionCacheKey,
  extractSourceText,
  filterConversationForOrganizationKnowledge,
  parseStructuredExtraction,
  planKnowledgeSourceDelete,
  preferAuthoritativeCurrent,
  scoreExtractionEval,
  sourceQualityForOrigin,
} from "./index.js";
import { KNOWLEDGE_EXTRACTION_EVAL_CASES } from "./extraction-eval.js";

function validJson(overrides?: Record<string, unknown>): string {
  return JSON.stringify({
    candidates: [
      {
        candidateType: "fact",
        factStatus: "fact",
        title: "許可は取得済み",
        summary: "有料職業紹介の許可は取得済みである。",
        normalizedStatement: "有料職業紹介の許可は取得済みである。",
        domains: ["recruitment"],
        categories: [],
        tags: [],
        isCurrent: true,
        confidence: 0.8,
        sourceQuality: 0.9,
        evidence: { sourceChunkId: "c1", excerpt: "許可は取得済みである" },
        ...overrides,
      },
    ],
    skippedPrivate: false,
  });
}

describe("durable lease / retry / poison", () => {
  it("leases a job and expires so another worker can retry", async () => {
    const q = new InMemoryKnowledgeJobQueue();
    const id = await q.enqueue({ sourceId: "s1", orgId: "o1", createdBy: "u1" });
    const now = new Date("2026-08-17T00:00:00.000Z");
    const first = await q.claimJob({ jobId: id, owner: "w1", leaseSeconds: 30, now });
    expect(first?.status).toBe("processing");
    const blocked = await q.claimJob({
      jobId: id,
      owner: "w2",
      leaseSeconds: 30,
      now: new Date(now.getTime() + 1_000),
    });
    expect(blocked).toBeNull();
    const afterExpiry = await q.claimJob({
      jobId: id,
      owner: "w2",
      leaseSeconds: 30,
      now: new Date(now.getTime() + 31_000),
    });
    expect(afterExpiry?.leaseOwner).toBe("w2");
  });

  it("retries expired chunk leases and poisons after max attempts", async () => {
    const q = new InMemoryKnowledgeJobQueue();
    const jobId = await q.enqueue({ sourceId: "s1", orgId: "o1", createdBy: "u1" });
    q.seedChunks(jobId, [
      {
        id: "ch1",
        jobId,
        chunkIndex: 0,
        content: "本文",
        contentHash: "h1",
        status: "pending",
        attemptCount: 0,
        leaseExpiresAt: null,
      },
    ]);
    const now = new Date("2026-08-17T00:00:00.000Z");
    const first = await q.claimChunks({
      jobId,
      limit: 1,
      leaseSeconds: 10,
      includeWaitingForExtractor: false,
      maxAttempts: 3,
      now,
    });
    expect(first).toHaveLength(1);
    const expired = await q.claimChunks({
      jobId,
      limit: 1,
      leaseSeconds: 10,
      includeWaitingForExtractor: false,
      maxAttempts: 3,
      now: new Date(now.getTime() + 11_000),
    });
    expect(expired[0]?.attemptCount).toBe(2);
    await q.claimChunks({
      jobId,
      limit: 1,
      leaseSeconds: 10,
      includeWaitingForExtractor: false,
      maxAttempts: 3,
      now: new Date(now.getTime() + 22_000),
    });
    const poisoned = q.poisonAfterMaxAttempts(jobId, 3);
    expect(poisoned[0]?.status).toBe("failed");
  });
});

describe("extractor validation / versioning / cache", () => {
  it("rejects invalid JSON instead of patching success", () => {
    const parsed = parseStructuredExtraction("not json");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("invalid_json");
  });

  it("rejects schema-invalid structured output", () => {
    const parsed = parseStructuredExtraction(
      JSON.stringify({ candidates: [{ title: "x" }] }),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("schema_failed");
  });

  it("retries invalid model output then marks invalid, never fabricating candidates", async () => {
    let calls = 0;
    const provider = new LlmKnowledgeExtractionProvider(async () => {
      calls += 1;
      return {
        text: "{bad",
        modelId: "test-model",
        role: "fast",
        connected: true,
      };
    });
    const out = await provider.extractChunk({
      originKind: "paste",
      title: "t",
      chunkId: "c1",
      chunkText: "現在実施している。",
      chunkHash: "hash-1",
      chunkIndex: 0,
      visibility: "organization",
    });
    expect(out.status).toBe("invalid");
    expect(out.drafts).toEqual([]);
    expect(calls).toBe(DEFAULT_KNOWLEDGE_EXTRACTION_BUDGET.maxRetries);
  });

  it("caches by chunk hash + extractor/model/prompt version", async () => {
    let calls = 0;
    const cache = new InMemoryKnowledgeExtractionCache();
    const provider = new LlmKnowledgeExtractionProvider(async () => {
      calls += 1;
      return {
        text: validJson(),
        modelId: "test-model",
        role: "fast",
        connected: true,
      };
    }, cache);
    const input = {
      originKind: "paste" as const,
      title: "t",
      chunkId: "c1",
      chunkText: "許可は取得済みである。",
      chunkHash: "abc",
      chunkIndex: 0,
      visibility: "organization",
      domainKeys: ["recruitment"],
    };
    const first = await provider.extractChunk(input);
    const second = await provider.extractChunk(input);
    expect(first.status).toBe("extracted");
    expect(second.status).toBe("extracted");
    if (second.status === "extracted") expect(second.cached).toBe(true);
    expect(calls).toBe(1);
    expect(
      extractionCacheKey({
        chunkHash: "abc",
        extractorType: "llm",
        extractorVersion: "llm-extractor-v1",
        modelId: "test-model",
        promptVersion: "kf-extract-v1",
      }),
    ).toContain("llm-extractor-v1");
  });

  it("waits when the model is unavailable instead of faking candidates", async () => {
    const provider = new LlmKnowledgeExtractionProvider(null);
    const out = await provider.extractChunk({
      originKind: "paste",
      title: "t",
      chunkId: "c1",
      chunkText: "現在実施している。",
      chunkHash: "h",
      chunkIndex: 0,
      visibility: "organization",
    });
    expect(out.status).toBe("waiting_for_extractor");
    expect(out.drafts).toEqual([]);
  });

  it("records extractor versioning on successful drafts", async () => {
    const provider = new LlmKnowledgeExtractionProvider(async () => ({
      text: validJson(),
      modelId: "openai/gpt-4.1-mini",
      role: "fast",
      connected: true,
    }));
    const out = await provider.extractChunk({
      originKind: "authoritative_seed",
      title: "seed",
      chunkId: "c1",
      chunkText: "許可は取得済みである。",
      chunkHash: "h",
      chunkIndex: 0,
      visibility: "organization",
    });
    expect(out.status).toBe("extracted");
    if (out.status === "extracted") {
      expect(out.extractorVersion).toBe("llm-extractor-v1");
      expect(out.drafts[0]?.sourceQuality).toBeGreaterThanOrEqual(0.9);
      expect(out.drafts[0]?.modelId).toBe("openai/gpt-4.1-mini");
    }
  });
});

describe("current vs historical / authoritative seed", () => {
  it("does not auto-supersede from recency alone", () => {
    const d = classifyKnowledgeConflict({
      title: "有料職業紹介の許可",
      body: "許可を取得済み",
      factStatus: "fact",
      originKind: "transcript",
      sourceQuality: 0.3,
      existing: [
        {
          id: "seed",
          title: "有料職業紹介の許可",
          body: "許可取得済み",
          factStatus: "fact",
          current: true,
          originKind: "authoritative_seed",
          sourceQuality: 0.95,
        },
      ],
    });
    expect(d.kind).toBe("conflict");
    expect(d.reason).toMatch(/authoritative_seed/);
  });

  it("ranks authoritative current above old transcript", () => {
    const ranked = preferAuthoritativeCurrent([
      { id: "old", current: true, originKind: "transcript", sourceQuality: 0.3 },
      { id: "seed", current: true, originKind: "authoritative_seed", sourceQuality: 0.95 },
    ]);
    expect(ranked[0]?.id).toBe("seed");
    expect(sourceQualityForOrigin("authoritative_seed")).toBeGreaterThan(
      sourceQualityForOrigin("transcript"),
    );
  });

  it("blocks batch approve for conflict, supersession, and visibility widening", () => {
    expect(canBatchApprove({ reviewStatus: "new", conflictKind: "new" })).toBe(true);
    expect(canBatchApprove({ reviewStatus: "possible_update", conflictKind: "supersession" })).toBe(
      false,
    );
    expect(
      canBatchApprove({
        reviewStatus: "new",
        conflictKind: "new",
        sourceVisibility: "private",
        suggestedVisibility: "organization",
      }),
    ).toBe(false);
  });
});

describe("private transcript filtering / storage / parse", () => {
  it("keeps work rules and drops private health lines", () => {
    const d = filterConversationForOrganizationKnowledge({
      originKind: "conversation",
      visibility: "organization",
      text: "昨日は体調が悪かった。\n○○案件の失敗後、提出前に二人確認する運用ルールにした。",
    });
    expect(d.allowOrganizationCandidate).toBe(true);
    expect(d.sanitizedText).toMatch(/運用ルール/);
    expect(d.sanitizedText).not.toMatch(/体調/);
  });

  it("does not auto-expand private conversation to organization candidates", () => {
    const d = filterConversationForOrganizationKnowledge({
      originKind: "conversation",
      visibility: "private",
      text: "営業の手順を変えた",
    });
    expect(d.allowOrganizationCandidate).toBe(false);
  });

  it("plans source delete without cascading published knowledge", () => {
    const plan = planKnowledgeSourceDelete({
      publishedDocumentCount: 2,
      candidateCount: 3,
    });
    expect(plan.cascadePublished).toBe(false);
    expect(plan.warning).toMatch(/公開ナレッジ 2/);
  });

  it("compensates storage/metadata orphans in the matching phase", async () => {
    const { nextOrphanCompensation } = await import("./source-retention.js");
    expect(nextOrphanCompensation("after_metadata")).toBe("soft_delete_metadata");
    expect(nextOrphanCompensation("after_storage")).toBe("remove_storage");
  });

  it("marks empty PDF as requires_ocr, not success", () => {
    const pdf = extractSourceText({
      mimeType: "application/pdf",
      filename: "scan.pdf",
      bytes: new Uint8Array([1, 2, 3, 4]),
    });
    expect(pdf.text).toBeNull();
    expect(pdf.requiresOcr || pdf.limitation === "requires_ocr").toBe(true);
  });

  it("keeps csv row provenance", () => {
    const csv = extractSourceText({
      mimeType: "text/csv",
      filename: "a.csv",
      bytes: new TextEncoder().encode("name,role\nA,営業"),
    });
    expect(csv.text).toMatch(/\[row:2\]/);
    expect(csv.text).toMatch(/営業/);
  });
});

describe("extraction evaluation fixtures A-J", () => {
  it("scores structured outputs against expected statuses", () => {
    const samples: Record<(typeof KNOWLEDGE_EXTRACTION_EVAL_CASES)[number]["id"], string> = {
      A: validJson({ factStatus: "fact", isCurrent: true }),
      B: validJson({
        factStatus: "proposal",
        isCurrent: false,
        title: "許可取得を検討中",
        excerpt: "検討している",
      }),
      C: validJson({ factStatus: "fact", isCurrent: true }),
      D: validJson({ factStatus: "rejected", isCurrent: false, title: "週休3日は却下" }),
      E: validJson({ candidateType: "qa", factStatus: "fact" }),
      F: validJson({ factStatus: "decision", title: "二人確認" }),
      G: validJson({ factStatus: "fact" }),
      H: validJson({ factStatus: "fact" }),
      I: validJson({ factStatus: "fact", title: "運用原則" }),
      J: JSON.stringify({ candidates: [], skippedPrivate: true }),
    };
    for (const spec of KNOWLEDGE_EXTRACTION_EVAL_CASES) {
      const scored = scoreExtractionEval({ caseId: spec.id, jsonText: samples[spec.id] });
      expect(scored.pass, spec.id + scored.reason).toBe(true);
    }
  });

  it("rejects sentence-level flood for reusable knowledge units", () => {
    const flood = {
      candidates: Array.from({ length: 8 }, (_, i) => ({
        candidateType: "fact",
        factStatus: "fact",
        title: `文${i + 1}`,
        summary: `一文${i + 1}`,
        normalizedStatement: `一文${i + 1}である。`,
        domains: ["company_common"],
        categories: [],
        tags: [],
        isCurrent: true,
        confidence: 0.8,
        sourceQuality: 0.9,
        evidence: { sourceChunkId: "c1", excerpt: `一文${i + 1}` },
      })),
      skippedPrivate: false,
    };
    const scored = scoreExtractionEval({ caseId: "I", jsonText: JSON.stringify(flood) });
    expect(scored.pass).toBe(false);
    expect(scored.reason).toBe("too_many_candidates");
  });
});

describe("idempotent candidate hash", () => {
  it("same chunk content hashes collide", async () => {
    const { sha256Hex } = await import("./hash.js");
    expect(sha256Hex("同じ候補")).toBe(sha256Hex("同じ候補"));
  });
});
