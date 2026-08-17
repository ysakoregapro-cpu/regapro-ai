import { describe, expect, it } from "vitest";
import {
  assertCanReviewKnowledge,
  decideKnowledgeReview,
  formatReviewSuccessNotice,
  hasKnowledgeReviewPermission,
  knowledgeReviewErrorMessage,
  planBatchKnowledgeReview,
  resolveEmbeddingPublishStatus,
} from "./approval.js";

const reviewer = ["knowledge:read", "knowledge:write", "knowledge:review"];
const writerOnly = ["knowledge:read", "knowledge:write"];
const openCandidate = {
  reviewStatus: "new",
  conflictKind: "new",
  publishedDocumentId: null,
  confidence: 0.9,
  sourceQuality: 0.95,
};

describe("knowledge review approval", () => {
  it("individual approve is allowed for reviewers", () => {
    const d = decideKnowledgeReview({
      permissionKeys: reviewer,
      action: "approve",
      candidate: openCandidate,
    });
    expect(d.kind).toBe("publish");
  });

  it("bulk approve skips conflict candidates", () => {
    const d = decideKnowledgeReview({
      permissionKeys: reviewer,
      action: "approve",
      batch: true,
      candidate: {
        ...openCandidate,
        reviewStatus: "conflict",
        conflictKind: "conflict",
      },
    });
    expect(d.kind).toBe("skip_batch");
    if (d.kind === "skip_batch") expect(d.reason).toBe("conflict");
  });

  it("individual approve of conflict requires explicit supersede", () => {
    const d = decideKnowledgeReview({
      permissionKeys: reviewer,
      action: "approve",
      candidate: {
        ...openCandidate,
        reviewStatus: "conflict",
        conflictKind: "conflict",
      },
    });
    expect(d.kind).toBe("conflict_supersede_required");
  });

  it("rejects unauthorized users before publish", () => {
    expect(hasKnowledgeReviewPermission(writerOnly)).toBe(false);
    expect(() => assertCanReviewKnowledge(writerOnly)).toThrow("UNAUTHORIZED_REVIEW");
    const d = decideKnowledgeReview({
      permissionKeys: writerOnly,
      action: "approve",
      candidate: openCandidate,
    });
    expect(d.kind).toBe("forbidden");
    expect(knowledgeReviewErrorMessage("UNAUTHORIZED_REVIEW")).toMatch(/レビュー権限/);
  });

  it("duplicate click is idempotent when already published", () => {
    const d = decideKnowledgeReview({
      permissionKeys: reviewer,
      action: "approve",
      candidate: {
        ...openCandidate,
        reviewStatus: "approved",
        publishedDocumentId: "doc-1",
      },
    });
    expect(d).toEqual({ kind: "idempotent", documentId: "doc-1" });
    expect(formatReviewSuccessNotice({ publishedCount: 1, alreadyPublished: true })).toBe(
      "公開済みです",
    );
  });

  it("maps publish success copy", () => {
    expect(formatReviewSuccessNotice({ publishedCount: 1 })).toBe("公開しました");
    expect(formatReviewSuccessNotice({ publishedCount: 3 })).toBe("3件を公開しました");
  });

  it("does not treat embedding failure as success copy", () => {
    expect(knowledgeReviewErrorMessage("EMBEDDING_FAILED")).toMatch(/公開を完了していません/);
    expect(resolveEmbeddingPublishStatus({ available: true, embedded: false })).toBe("failed");
    expect(resolveEmbeddingPublishStatus({ available: true, embedded: true })).toBe("ready");
  });

  it("bulk approve runs only selected ids and skips conflicts", () => {
    const selected = ["keep-1", "conflict-1", "keep-2"];
    const plan = planBatchKnowledgeReview({
      permissionKeys: reviewer,
      action: "approve",
      selectedIds: selected,
      candidatesById: {
        "keep-1": openCandidate,
        "conflict-1": {
          ...openCandidate,
          reviewStatus: "conflict",
          conflictKind: "conflict",
        },
        "keep-2": openCandidate,
        "unselected": openCandidate,
      },
    });
    expect(plan.toRun).toEqual(["keep-1", "keep-2"]);
    expect(plan.skipped).toEqual([{ id: "conflict-1", reason: "conflict" }]);
  });

  it("bulk plan rejects unauthorized users", () => {
    expect(() =>
      planBatchKnowledgeReview({
        permissionKeys: writerOnly,
        action: "approve",
        selectedIds: ["keep-1"],
        candidatesById: { "keep-1": openCandidate },
      }),
    ).toThrow("UNAUTHORIZED_REVIEW");
  });

  it("maps action failure codes to user-facing errors", () => {
    expect(knowledgeReviewErrorMessage("document insert failed")).toMatch(/^公開に失敗しました:/);
    expect(knowledgeReviewErrorMessage("ALREADY_IN_FLIGHT")).toMatch(/実行中/);
  });

  it("turns approved candidate content into retrieval chunks", async () => {
    const { splitKnowledgeBody, planChunkUpserts } = await import("./chunker.js");
    const drafts = splitKnowledgeBody("提案書は提出前に二人確認する。例外は部門長の事前承認がある場合のみ。");
    expect(drafts.length).toBeGreaterThan(0);
    const plan = planChunkUpserts({ drafts, existing: [] });
    expect(plan.toUpsert.length).toBe(drafts.length);
    expect(plan.toUpsert[0]?.content).toMatch(/二人確認/);
  });
});
