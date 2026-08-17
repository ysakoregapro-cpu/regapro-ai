import { describe, expect, it } from "vitest";
import { reviewFeedbackFromResponse } from "./knowledge-review-response";

describe("knowledge review API feedback", () => {
  it("maps individual approve success to 公開しました", () => {
    const fb = reviewFeedbackFromResponse({
      httpOk: true,
      kind: "individual",
      action: "approve",
      body: { ok: true, published: true, documentId: "doc-1", publishedCount: 1 },
    });
    expect(fb.error).toBeNull();
    expect(fb.notice).toBe("公開しました");
  });

  it("maps bulk approve success count", () => {
    const fb = reviewFeedbackFromResponse({
      httpOk: true,
      kind: "batch",
      action: "approve",
      body: {
        ok: true,
        approvedIds: ["a", "b", "c"],
        skipped: [],
        failed: [],
        publishedCount: 3,
      },
    });
    expect(fb.notice).toBe("3件を公開しました");
    expect(fb.error).toBeNull();
  });

  it("keeps conflict skips out of published count", () => {
    const fb = reviewFeedbackFromResponse({
      httpOk: true,
      kind: "batch",
      action: "approve",
      body: {
        ok: true,
        approvedIds: ["a"],
        skipped: ["conflict-1"],
        failed: [],
        publishedCount: 1,
      },
    });
    expect(fb.notice).toBe("公開しました");
    expect(fb.error).toBeNull();
  });

  it("returns unauthorized errors from the action", () => {
    const fb = reviewFeedbackFromResponse({
      httpOk: false,
      kind: "individual",
      action: "approve",
      body: {
        error: "公開する権限がありません。レビュー権限が必要です。",
        code: "UNAUTHORIZED_REVIEW",
      },
    });
    expect(fb.notice).toBeNull();
    expect(fb.error).toMatch(/レビュー権限/);
  });

  it("treats already-published duplicate click as success, not a second publish", () => {
    const fb = reviewFeedbackFromResponse({
      httpOk: true,
      kind: "individual",
      action: "approve",
      body: { ok: true, published: true, alreadyPublished: true, documentId: "doc-1" },
    });
    expect(fb.notice).toBe("公開済みです");
  });

  it("surfaces action failures instead of silent success", () => {
    const fb = reviewFeedbackFromResponse({
      httpOk: false,
      kind: "individual",
      action: "approve",
      body: { error: "公開に失敗しました: document insert failed", code: "document insert failed" },
    });
    expect(fb.error).toMatch(/公開に失敗しました/);
    expect(fb.notice).toBeNull();
  });

  it("does not treat embedding failure as published success", () => {
    const fb = reviewFeedbackFromResponse({
      httpOk: false,
      kind: "individual",
      action: "approve",
      body: {
        error: "検索用の準備（embedding）に失敗したため、公開を完了していません。",
        code: "EMBEDDING_FAILED",
      },
    });
    expect(fb.notice).toBeNull();
    expect(fb.error).toMatch(/公開を完了していません/);
  });

  it("shows bulk partial failure with published count", () => {
    const fb = reviewFeedbackFromResponse({
      httpOk: true,
      kind: "batch",
      action: "approve",
      body: {
        ok: true,
        approvedIds: ["a"],
        skipped: [],
        failed: [{ id: "b", error: "検索用の準備（embedding）に失敗したため、公開を完了していません。" }],
        publishedCount: 1,
      },
    });
    expect(fb.notice).toBe("公開しました");
    expect(fb.error).toMatch(/公開に失敗しました/);
  });
});
