export function knowledgeReviewErrorMessage(code: string): string {
  switch (code) {
    case "UNAUTHORIZED_REVIEW":
      return "公開する権限がありません。レビュー権限が必要です。";
    case "CANDIDATE_NOT_FOUND":
      return "候補が見つかりません。";
    case "CONFLICT_REQUIRES_EXPLICIT_SUPERSEDE":
      return "矛盾がある候補は通常の承認できません。置き換えて承認を使ってください。";
    case "EMBEDDING_FAILED":
      return "検索用の準備（embedding）に失敗したため、公開を完了していません。";
    case "EMBEDDING_TIMEOUT":
      return "検索用の準備が時間切れになりました。公開を完了していません。";
    case "NO_SELECTION":
      return "候補を選択してください。";
    case "ALREADY_IN_FLIGHT":
      return "公開処理の実行中です。";
    default:
      if (/row-level security|42501|permission denied/i.test(code)) {
        return "権限またはセキュリティ方針により保存できませんでした。";
      }
      if (/UNAUTHORIZED/i.test(code)) {
        return "この操作を行う権限がありません。";
      }
      return `公開に失敗しました: ${code.slice(0, 180)}`;
  }
}

export function formatReviewSuccessNotice(input: {
  publishedCount: number;
  skippedCount?: number;
  alreadyPublished?: boolean;
}): string {
  if (input.alreadyPublished) return "公開済みです";
  if (input.publishedCount <= 0) {
    if ((input.skippedCount ?? 0) > 0) {
      return `0件を公開しました（${input.skippedCount} 件は対象外）`;
    }
    return "公開対象がありませんでした";
  }
  if (input.publishedCount === 1) return "公開しました";
  return `${input.publishedCount}件を公開しました`;
}
