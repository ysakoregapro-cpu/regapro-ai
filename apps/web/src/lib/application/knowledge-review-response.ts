import {
  formatReviewSuccessNotice,
  knowledgeReviewErrorMessage,
} from "@regapro/knowledge/approval-messages";

export type FactoryReviewFailedItem = { id: string; error: string };

export type FactoryReviewResponse = {
  ok?: boolean;
  error?: string;
  code?: string;
  published?: boolean;
  alreadyPublished?: boolean;
  documentId?: string;
  approvedIds?: string[];
  skipped?: string[];
  failed?: FactoryReviewFailedItem[];
  publishedCount?: number;
};

export function reviewFeedbackFromResponse(input: {
  httpOk: boolean;
  body: FactoryReviewResponse;
  kind: "individual" | "batch";
  action: string;
}): { error: string | null; notice: string | null } {
  if (!input.httpOk) {
    return {
      error:
        input.body.error ??
        knowledgeReviewErrorMessage(input.body.code ?? "failed"),
      notice: null,
    };
  }

  const publishAction =
    input.action === "approve" ||
    input.action === "edit_approve" ||
    input.action === "supersede";

  if (input.kind === "individual") {
    if (!publishAction) {
      return { error: null, notice: "更新しました" };
    }
    return {
      error: null,
      notice: formatReviewSuccessNotice({
        publishedCount:
          input.body.published || input.body.alreadyPublished ? 1 : 0,
        alreadyPublished: input.body.alreadyPublished,
      }),
    };
  }

  const publishedCount =
    input.body.publishedCount ?? input.body.approvedIds?.length ?? 0;
  const skippedCount = input.body.skipped?.length ?? 0;
  const failed = input.body.failed ?? [];
  const notice = formatReviewSuccessNotice({ publishedCount, skippedCount });
  if (failed.length > 0) {
    const reason = failed[0]?.error ?? "不明なエラー";
    const prefixed = reason.startsWith("公開に失敗しました")
      ? reason
      : `公開に失敗しました: ${reason}`;
    return {
      error: prefixed,
      notice: publishedCount > 0 ? notice : null,
    };
  }
  return { error: null, notice };
}
