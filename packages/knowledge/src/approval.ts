import { canBatchApprove } from "./conflict.js";

export type KnowledgeReviewAction =
  | "approve"
  | "edit_approve"
  | "reject"
  | "merge"
  | "mark_duplicate"
  | "supersede";

export function hasKnowledgeReviewPermission(permissionKeys: readonly string[]): boolean {
  return (
    permissionKeys.includes("knowledge:review") ||
    permissionKeys.includes("knowledge:approve")
  );
}

export function assertCanReviewKnowledge(permissionKeys: readonly string[]): void {
  if (!hasKnowledgeReviewPermission(permissionKeys)) {
    throw new Error("UNAUTHORIZED_REVIEW");
  }
}

export type ReviewDecision =
  | { kind: "forbidden"; code: "UNAUTHORIZED_REVIEW" }
  | { kind: "not_found"; code: "CANDIDATE_NOT_FOUND" }
  | { kind: "idempotent"; documentId: string }
  | { kind: "conflict_supersede_required"; code: "CONFLICT_REQUIRES_EXPLICIT_SUPERSEDE" }
  | { kind: "reject" }
  | { kind: "publish" }
  | { kind: "skip_batch"; reason: "conflict" | "not_batchable" };

export function decideKnowledgeReview(input: {
  permissionKeys: readonly string[];
  action: KnowledgeReviewAction;
  candidate: {
    id?: string | null;
    reviewStatus: string;
    conflictKind: string;
    publishedDocumentId?: string | null;
    suggestedVisibility?: string | null;
    confidence?: number | null;
    sourceQuality?: number | null;
  } | null;
  batch?: boolean;
}): ReviewDecision {
  if (!hasKnowledgeReviewPermission(input.permissionKeys)) {
    return { kind: "forbidden", code: "UNAUTHORIZED_REVIEW" };
  }
  if (!input.candidate) {
    return { kind: "not_found", code: "CANDIDATE_NOT_FOUND" };
  }
  const publishedId = input.candidate.publishedDocumentId;
  if (
    (input.action === "approve" ||
      input.action === "edit_approve" ||
      input.action === "supersede") &&
    input.candidate.reviewStatus === "approved" &&
    publishedId
  ) {
    return { kind: "idempotent", documentId: publishedId };
  }
  if (input.batch && input.action === "approve") {
    if (
      !canBatchApprove({
        reviewStatus: input.candidate.reviewStatus,
        conflictKind: input.candidate.conflictKind,
        suggestedVisibility: input.candidate.suggestedVisibility,
        confidence: input.candidate.confidence,
        sourceQuality: input.candidate.sourceQuality,
      })
    ) {
      return {
        kind: "skip_batch",
        reason: input.candidate.conflictKind === "conflict" ? "conflict" : "not_batchable",
      };
    }
  }
  if (input.action === "approve" && input.candidate.conflictKind === "conflict") {
    return {
      kind: "conflict_supersede_required",
      code: "CONFLICT_REQUIRES_EXPLICIT_SUPERSEDE",
    };
  }
  if (input.action === "reject" || input.action === "mark_duplicate") {
    return { kind: "reject" };
  }
  return { kind: "publish" };
}

export type BatchReviewPlan = {
  toRun: string[];
  skipped: Array<{ id: string; reason: "conflict" | "not_batchable" | "not_found" }>;
};

export function planBatchKnowledgeReview(input: {
  permissionKeys: readonly string[];
  action: "approve" | "reject";
  selectedIds: readonly string[];
  candidatesById: Record<
    string,
    {
      reviewStatus: string;
      conflictKind: string;
      publishedDocumentId?: string | null;
      suggestedVisibility?: string | null;
      confidence?: number | null;
      sourceQuality?: number | null;
    } | null | undefined
  >;
}): BatchReviewPlan {
  assertCanReviewKnowledge(input.permissionKeys);
  const toRun: string[] = [];
  const skipped: BatchReviewPlan["skipped"] = [];
  for (const id of input.selectedIds) {
    const row = input.candidatesById[id];
    const decision = decideKnowledgeReview({
      permissionKeys: input.permissionKeys,
      action: input.action,
      batch: input.action === "approve",
      candidate: row
        ? {
            reviewStatus: row.reviewStatus,
            conflictKind: row.conflictKind,
            publishedDocumentId: row.publishedDocumentId,
            suggestedVisibility: row.suggestedVisibility,
            confidence: row.confidence,
            sourceQuality: row.sourceQuality,
          }
        : null,
    });
    if (decision.kind === "skip_batch") {
      skipped.push({ id, reason: decision.reason });
      continue;
    }
    if (decision.kind === "conflict_supersede_required") {
      skipped.push({ id, reason: "conflict" });
      continue;
    }
    if (decision.kind === "not_found") {
      skipped.push({ id, reason: "not_found" });
      continue;
    }
    toRun.push(id);
  }
  return { toRun, skipped };
}

export function resolveEmbeddingPublishStatus(input: {
  available: boolean;
  embedded: boolean;
}): "ready" | "failed" | "skipped" {
  if (!input.available) return "skipped";
  return input.embedded ? "ready" : "failed";
}

export {
  formatReviewSuccessNotice,
  knowledgeReviewErrorMessage,
} from "./approval-messages.js";
