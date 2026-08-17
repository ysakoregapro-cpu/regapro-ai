export type SourceDeletePlan = {
  allowed: boolean;
  cascadePublished: false;
  publishedDocumentCount: number;
  candidateCount: number;
  warning: string | null;
};

/**
 * Published Knowledge is not cascade-deleted when a Source is removed.
 * Operators get a dependency warning and must archive/supersede Knowledge separately.
 */
export function planKnowledgeSourceDelete(input: {
  publishedDocumentCount: number;
  candidateCount: number;
}): SourceDeletePlan {
  const hasDeps = input.publishedDocumentCount > 0 || input.candidateCount > 0;
  return {
    allowed: true,
    cascadePublished: false,
    publishedDocumentCount: input.publishedDocumentCount,
    candidateCount: input.candidateCount,
    warning: hasDeps
      ? `この原本を削除しても公開ナレッジ ${input.publishedDocumentCount} 件と候補 ${input.candidateCount} 件は残ります。公開ナレッジは別途アーカイブしてください。`
      : null,
  };
}

export function buildKnowledgeSourceStoragePath(input: {
  orgId: string;
  sourceId: string;
  filename: string;
}): string {
  const safe = input.filename.replace(/[/\\?%*:|"<>]/g, "_").trim() || "file";
  return `org/${input.orgId}/knowledge-sources/${input.sourceId}/${safe.slice(0, 180)}`;
}

export function nextOrphanCompensation(
  phase: "after_metadata" | "after_storage",
): "soft_delete_metadata" | "remove_storage" {
  return phase === "after_metadata" ? "soft_delete_metadata" : "remove_storage";
}

export const KNOWLEDGE_SOURCES_BUCKET = "knowledge-sources";
