import { confidentialityRank } from "@regapro/shared";
import { classifyKnowledgeConflict, sourceQualityForOrigin, type ExistingKnowledgeRef } from "./conflict.js";
import { normalizeKnowledgeText, sha256Hex } from "./hash.js";
import type { ResolvedImportItem } from "./import-manifest.js";
import { assertNoSecurityPromotion } from "./visibility.js";

export const STRUCTURED_EXTRACTOR_TYPE = "structured-import";
export const STRUCTURED_EXTRACTOR_VERSION = "structured-import-v1";

export type StructuredImportRecords = {
  source: {
    name: string;
    source_type: string;
    origin_kind: string;
    raw_text: string;
    normalized_text: string;
    content_hash: string;
    checksum: string;
    confidentiality_level: number;
    visibility: string;
    department_id: string | null;
    project_id: string | null;
    source_date: string | null;
    metadata: Record<string, unknown>;
  };
  chunk: {
    chunk_index: number;
    content: string;
    content_hash: string;
    status: "completed";
  };
  candidate: {
    title: string;
    content: string;
    content_hash: string;
    suggested_confidentiality_level: number;
    suggested_visibility: string;
    candidate_type: string;
    fact_status: string;
    review_status: string;
    domain_keys: string[];
    summary: string;
    tags: string[];
    conflict_kind: string;
    conflict_reason: string | null;
    supersedes_document_id: string | null;
    confidence: number;
    source_quality: number;
    is_current: boolean;
    valid_from: string | null;
    valid_until: string | null;
    source_date: string | null;
    source_excerpt: string;
    extractor_type: string;
    extractor_version: string;
    prompt_version: string;
    status: "draft";
  };
  job: {
    status: "completed";
    total_units: number;
    processed_units: number;
    failed_units: number;
  };
};

export function originKindForImportItem(item: ResolvedImportItem): string {
  if (item.authoritativeSeed) return "authoritative_seed";
  if (item.importMode === "qa") return "qa";
  if (item.importMode === "source") return item.file ? "file" : "paste";
  return "paste";
}

export function buildStructuredImportRecords(input: {
  item: ResolvedImportItem;
  existingPublished?: ExistingKnowledgeRef[];
}): StructuredImportRecords {
  const item = input.item;
  if (item.importMode !== "structured" && item.importMode !== "qa") {
    throw new Error("structured_records_require_structured_or_qa");
  }
  const originKind = originKindForImportItem(item);
  const normalized = normalizeKnowledgeText(item.content);
  const contentHash = sha256Hex(normalized);
  const level = confidentialityRank(item.clearanceLevel);
  const visibility = item.visibility;
  assertNoSecurityPromotion({
    sourceVisibility: visibility,
    targetVisibility: visibility,
    sourceLevel: item.clearanceLevel,
    targetLevel: item.clearanceLevel,
  });
  const quality =
    item.sourceQuality ??
    (item.authoritativeSeed ? sourceQualityForOrigin("authoritative_seed") : sourceQualityForOrigin(originKind));
  const conflict = classifyKnowledgeConflict({
    title: item.title,
    body: normalized,
    factStatus: item.factStatus,
    isCurrent: item.isCurrent,
    sourceQuality: quality,
    originKind,
    sourceDate: item.sourceDate,
    existing: input.existingPublished ?? [],
  });
  const reviewStatus =
    conflict.kind === "duplicate"
      ? "duplicate"
      : conflict.kind === "conflict"
        ? "conflict"
        : conflict.kind === "supersession"
          ? "possible_update"
          : "new";
  const excerpt = normalized.slice(0, 500);
  const summary = normalized.slice(0, 280);
  const tags = [
    ...item.tags,
    `import-item:${item.id}`,
    item.authoritativeSeed ? "authoritative-seed" : null,
  ].filter((t): t is string => Boolean(t));

  return {
    source: {
      name: item.title.slice(0, 200),
      source_type: originKind,
      origin_kind: originKind,
      raw_text: item.content,
      normalized_text: normalized,
      content_hash: item.contentHash,
      checksum: item.checksum,
      confidentiality_level: level,
      visibility,
      department_id: item.departmentId,
      project_id: item.projectId,
      source_date: item.sourceDate,
      metadata: {
        importItemId: item.id,
        importMode: item.importMode,
        domainKeys: item.domains,
        sourceQuality: quality,
        authoritativeSeed: item.authoritativeSeed,
        question: item.question,
        answer: item.answer,
        expertName: item.expertName,
      },
    },
    chunk: {
      chunk_index: 0,
      content: normalized,
      content_hash: contentHash,
      status: "completed",
    },
    candidate: {
      title: item.title.slice(0, 200),
      content: normalized.slice(0, 8_000),
      content_hash: contentHash,
      suggested_confidentiality_level: level,
      suggested_visibility: visibility,
      candidate_type: item.candidateType,
      fact_status: item.factStatus,
      review_status: reviewStatus,
      domain_keys: [...item.domains],
      summary,
      tags,
      conflict_kind: conflict.kind,
      conflict_reason: conflict.reason,
      supersedes_document_id: conflict.existingId,
      confidence: item.authoritativeSeed ? 0.9 : 0.75,
      source_quality: quality,
      is_current: item.isCurrent,
      valid_from: item.validFrom,
      valid_until: item.validUntil,
      source_date: item.sourceDate,
      source_excerpt: excerpt,
      extractor_type: STRUCTURED_EXTRACTOR_TYPE,
      extractor_version: STRUCTURED_EXTRACTOR_VERSION,
      prompt_version: STRUCTURED_EXTRACTOR_VERSION,
      status: "draft",
    },
    job: {
      status: "completed",
      total_units: 1,
      processed_units: 1,
      failed_units: 0,
    },
  };
}

export function structuredCandidateCount(_item: ResolvedImportItem): 1 {
  return 1;
}
