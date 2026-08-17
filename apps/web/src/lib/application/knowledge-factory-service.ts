import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_KNOWLEDGE_EXTRACTION_BUDGET,
  DEFAULT_KNOWLEDGE_INGESTION_BUDGET,
  KnowledgeIngestionBudgetGuard,
  LlmKnowledgeExtractionProvider,
  assertNoSecurityPromotion,
  buildStructuredImportRecords,
  classifyKnowledgeConflict,
  decideKnowledgeReview,
  extractSourceText,
  hasKnowledgeReviewPermission,
  isKnowledgeCaptureUtterance,
  knowledgeReviewErrorMessage,
  planBatchKnowledgeReview,
  resolveEmbeddingPublishStatus,
  planConversationCapture,
  planKnowledgeSourceDelete,
  sha256Hex,
  sourceQualityForOrigin,
  splitKnowledgeBody,
  titleFromFilename,
  KnowledgeDomainKeySchema,
  type KnowledgeExtractionCache,
  type KnowledgeOriginKind,
  type KnowledgeReviewStatus,
  type ResolvedImportItem,
} from "@regapro/knowledge";
import {
  canAssignConfidentialityLevel,
  type AccessContext,
} from "@regapro/security";
import {
  confidentialityFromRank,
  confidentialityRank,
  type ConfidentialityLevel,
  type Visibility,
} from "@regapro/shared";
import type { Database } from "@/lib/supabase/types";
import { ingestPublishedDocumentChunks } from "@/lib/application/knowledge-ingest-service";
import { createEmbeddingProvider } from "@regapro/local-ai";
import { createWebIntelligenceDeps, domainFromUrl } from "@regapro/web-intelligence";
import { emitRuntimeTrace } from "@regapro/observability";
import { createKnowledgeExtractionGenerate } from "@/lib/application/knowledge-extraction-runtime";
import {
  compensateKnowledgeSourceOrphan,
  storeKnowledgeSourceOriginal,
} from "@/lib/application/knowledge-source-storage";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<Database, "public", any>;

export type FactorySourceInput = {
  orgId: string;
  userId: string;
  access: AccessContext;
  originKind: KnowledgeOriginKind;
  title: string;
  text: string;
  sourceId?: string;
  question?: string | null;
  answer?: string | null;
  url?: string | null;
  canonicalUrl?: string | null;
  domain?: string | null;
  fileObjectId?: string | null;
  confidentialityLevel: ConfidentialityLevel;
  visibility: Visibility;
  departmentId?: string | null;
  projectId?: string | null;
  originThreadId?: string | null;
  originMessageId?: string | null;
  domainKeys?: string[];
  sourceDate?: string | null;
  containsPersonalConversation?: boolean;
  /** Conversation capture may proceed with knowledge:read. */
  captureMode?: boolean;
  storagePath?: string | null;
  originalFilename?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  checksum?: string | null;
  requiresOcr?: boolean;
  skipImmediateProcess?: boolean;
  importItemId?: string;
  importMode?: "structured" | "source" | "qa";
  candidateType?: ResolvedImportItem["candidateType"];
  factStatus?: ResolvedImportItem["factStatus"];
  isCurrent?: boolean;
  sourceQuality?: number;
  tags?: string[];
  validFrom?: string | null;
  validUntil?: string | null;
  expertName?: string | null;
};

function clampLevel(
  access: AccessContext,
  requested: ConfidentialityLevel,
): ConfidentialityLevel {
  if (canAssignConfidentialityLevel(access, requested)) return requested;
  return access.maximumConfidentialityLevel;
}

function requireWrite(access: AccessContext): void {
  if (!access.permissionKeys.includes("knowledge:write")) {
    throw new Error("UNAUTHORIZED_KNOWLEDGE_WRITE");
  }
}

function requireReview(access: AccessContext): void {
  if (!hasKnowledgeReviewPermission(access.permissionKeys)) {
    throw new Error("UNAUTHORIZED_REVIEW");
  }
}

function throwIfError(error: { message: string } | null | undefined, fallback: string): void {
  if (error) throw new Error(error.message || fallback);
}

const reviewInFlight = new Set<string>();

async function withTimeout<T>(promise: Promise<T>, ms: number, code: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(code)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

class PostgresKnowledgeExtractionCache implements KnowledgeExtractionCache {
  constructor(
    private readonly client: Client,
    private readonly orgId: string,
  ) {}

  async get(key: string): Promise<import("@regapro/knowledge").ExtractedCandidateDraft[] | null> {
    const [hash, extractorType, extractorVersion, modelId, promptVersion] = key.split(":");
    const { data } = await this.client
      .from("knowledge_extraction_cache")
      .select("result")
      .eq("org_id", this.orgId)
      .eq("source_chunk_hash", hash ?? "")
      .eq("extractor_type", extractorType ?? "")
      .eq("extractor_version", extractorVersion ?? "")
      .eq("model_id", modelId ?? "")
      .eq("prompt_version", promptVersion ?? "")
      .maybeSingle();
    const result = data?.result as import("@regapro/knowledge").ExtractedCandidateDraft[] | undefined;
    return result ?? null;
  }

  async set(
    key: string,
    value: import("@regapro/knowledge").ExtractedCandidateDraft[],
  ): Promise<void> {
    const [hash, extractorType, extractorVersion, modelId, promptVersion] = key.split(":");
    await this.client.from("knowledge_extraction_cache").upsert(
      {
        org_id: this.orgId,
        source_chunk_hash: hash ?? "",
        extractor_type: extractorType ?? "",
        extractor_version: extractorVersion ?? "",
        model_id: modelId ?? "",
        prompt_version: promptVersion ?? "",
        result: value,
      },
      {
        onConflict:
          "org_id,source_chunk_hash,extractor_type,extractor_version,model_id,prompt_version",
      },
    );
  }
}

function workerOwner(): string {
  return `web:${process.env.VERCEL_REGION ?? "local"}:${process.pid}`;
}

async function upsertSourceChunk(
  client: Client,
  row: {
    org_id: string;
    source_id: string;
    job_id: string;
    chunk_index: number;
    content: string;
    content_hash: string;
    status: string;
  },
): Promise<void> {
  const { error } = await client.from("knowledge_source_chunks").upsert(row, {
    onConflict: "source_id,chunk_index",
  });
  if (!error) return;
  const { data: hit } = await client
    .from("knowledge_source_chunks")
    .select("id")
    .eq("source_id", row.source_id)
    .eq("chunk_index", row.chunk_index)
    .is("deleted_at", null)
    .maybeSingle();
  if (hit?.id) {
    const { error: uErr } = await client
      .from("knowledge_source_chunks")
      .update(row)
      .eq("id", hit.id);
    if (uErr) throw new Error(uErr.message);
    return;
  }
  const { error: iErr } = await client.from("knowledge_source_chunks").insert(row);
  if (iErr && !/duplicate|unique/i.test(iErr.message)) {
    throw new Error(iErr.message);
  }
}

export async function createKnowledgeSourceAndJob(
  client: Client,
  input: FactorySourceInput,
): Promise<{ sourceId: string; jobId: string; duplicate: boolean }> {
  if (input.captureMode || input.originKind === "conversation") {
    if (!input.access.permissionKeys.includes("knowledge:read")) {
      throw new Error("UNAUTHORIZED_KNOWLEDGE_WRITE");
    }
  } else {
    requireWrite(input.access);
  }
  const level = clampLevel(input.access, input.confidentialityLevel);
  if (input.visibility === "organization" && input.containsPersonalConversation) {
    throw new Error("PERSONAL_CONVERSATION_NOT_ORG_KNOWLEDGE");
  }
  const hash = input.text.trim()
    ? sha256Hex(input.text)
    : (input.checksum ?? sha256Hex(input.originKind + (input.originalFilename ?? "")));
  if (input.checksum) {
    const { data: byFile } = await client
      .from("knowledge_sources")
      .select("id")
      .eq("org_id", input.orgId)
      .eq("checksum", input.checksum)
      .is("deleted_at", null)
      .maybeSingle();
    if (byFile?.id) {
      const { data: job } = await client
        .from("knowledge_ingestion_jobs")
        .select("id")
        .eq("source_id", byFile.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (job?.id) return { sourceId: byFile.id, jobId: job.id, duplicate: true };
    }
  }
  const { data: existing } = await client
    .from("knowledge_sources")
    .select("id")
    .eq("org_id", input.orgId)
    .eq("content_hash", hash)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing?.id) {
    const { data: job } = await client
      .from("knowledge_ingestion_jobs")
      .select("id")
      .eq("source_id", existing.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (job?.id) {
      return { sourceId: existing.id, jobId: job.id, duplicate: true };
    }
    const { data: createdJob, error: jErr } = await client
      .from("knowledge_ingestion_jobs")
      .insert({
        org_id: input.orgId,
        source_id: existing.id,
        status: "pending",
        created_by: input.userId,
        budget: DEFAULT_KNOWLEDGE_INGESTION_BUDGET,
      })
      .select("id")
      .single();
    if (jErr || !createdJob) throw new Error(jErr?.message ?? "job insert failed");
    return { sourceId: existing.id, jobId: createdJob.id, duplicate: true };
  }

  const { data: source, error: sErr } = await client
    .from("knowledge_sources")
    .insert({
      ...(input.sourceId ? { id: input.sourceId } : {}),
      org_id: input.orgId,
      name: input.title.slice(0, 200),
      source_type: input.originKind,
      origin_kind: input.originKind,
      raw_text: input.text,
      normalized_text: input.text,
      content_hash: hash,
      file_object_id: input.fileObjectId ?? null,
      storage_path: input.storagePath ?? null,
      original_filename: input.originalFilename ?? null,
      mime_type: input.mimeType ?? null,
      size_bytes: input.sizeBytes ?? null,
      checksum: input.checksum ?? null,
      requires_ocr: Boolean(input.requiresOcr),
      origin_url: input.url ?? null,
      canonical_url: input.canonicalUrl ?? input.url ?? null,
      domain: input.domain ?? null,
      confidentiality_level: confidentialityRank(level),
      visibility: input.visibility,
      owner_user_id: input.userId,
      department_id: input.departmentId ?? null,
      project_id: input.projectId ?? null,
      origin_thread_id: input.originThreadId ?? null,
      origin_message_id: input.originMessageId ?? null,
      source_date: input.sourceDate ?? null,
      observed_at: new Date().toISOString(),
      metadata: {
        question: input.question ?? null,
        answer: input.answer ?? null,
        domainKeys: input.domainKeys ?? ["company_common"],
        sourceQuality: sourceQualityForOrigin(input.originKind),
        importItemId: input.importItemId ?? null,
        importMode: input.importMode ?? null,
      },
      contains_personal_conversation: Boolean(input.containsPersonalConversation),
    })
    .select("id")
    .single();
  if (sErr || !source) throw new Error(sErr?.message ?? "source insert failed");

  const budget = DEFAULT_KNOWLEDGE_INGESTION_BUDGET;
  const { data: job, error: jErr } = await client
    .from("knowledge_ingestion_jobs")
    .insert({
      org_id: input.orgId,
      source_id: source.id,
      status: "pending",
      created_by: input.userId,
      budget,
    })
    .select("id")
    .single();
  if (jErr || !job) throw new Error(jErr?.message ?? "job insert failed");
  if (input.requiresOcr) {
    await client
      .from("knowledge_ingestion_jobs")
      .update({
        status: "failed",
        last_error_code: "requires_ocr",
        error_summary: "requires_ocr",
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);
  }
  return { sourceId: source.id, jobId: job.id, duplicate: false };
}

function toResolvedImportItem(input: FactorySourceInput): ResolvedImportItem {
  const importMode = input.importMode ?? (input.originKind === "qa" ? "qa" : "structured");
  const content = input.text;
  const contentHash = sha256Hex(content);
  const domains = (input.domainKeys ?? [])
    .map((key) => KnowledgeDomainKeySchema.safeParse(key))
    .filter((r): r is { success: true; data: ResolvedImportItem["domains"][number] } => r.success)
    .map((r) => r.data);
  return {
    id: input.importItemId ?? `ui-${contentHash.slice(0, 20)}`,
    title: input.title,
    importMode: importMode === "source" ? "structured" : importMode,
    domains: domains.length ? (domains as ResolvedImportItem["domains"]) : ["company_common"],
    clearanceLevel: input.confidentialityLevel,
    visibility: input.visibility,
    departmentId: input.departmentId ?? null,
    projectId: input.projectId ?? null,
    candidateType: input.candidateType ?? (input.originKind === "qa" ? "qa" : "policy"),
    factStatus: input.factStatus ?? "fact",
    isCurrent: input.isCurrent ?? true,
    sourceDate: input.sourceDate ?? null,
    validFrom: input.validFrom ?? null,
    validUntil: input.validUntil ?? null,
    sourceQuality: input.sourceQuality ?? sourceQualityForOrigin(input.originKind),
    tags: input.tags ?? [],
    authoritativeSeed: input.originKind === "authoritative_seed",
    question: input.question ?? null,
    answer: input.answer ?? null,
    expertName: input.expertName ?? null,
    file: input.originalFilename ?? null,
    content,
    contentHash,
    checksum: input.checksum ?? contentHash,
    charCount: content.length,
  };
}

export async function createStructuredKnowledgeItem(
  client: Client,
  input: FactorySourceInput,
): Promise<{
  sourceId: string;
  jobId: string;
  candidateId: string | null;
  duplicate: boolean;
  published: false;
}> {
  requireWrite(input.access);
  const level = clampLevel(input.access, input.confidentialityLevel);
  const item = toResolvedImportItem({ ...input, confidentialityLevel: level });
  const hash = item.contentHash;

  const { data: byItem } = await client
    .from("knowledge_sources")
    .select("id")
    .eq("org_id", input.orgId)
    .contains("metadata", { importItemId: item.id })
    .is("deleted_at", null)
    .maybeSingle();
  const { data: byHash } = await client
    .from("knowledge_sources")
    .select("id")
    .eq("org_id", input.orgId)
    .eq("content_hash", hash)
    .is("deleted_at", null)
    .maybeSingle();
  const existingId = byItem?.id ?? byHash?.id;
  if (existingId) {
    const { data: existingCand } = await client
      .from("knowledge_candidates")
      .select("id")
      .eq("source_id", existingId)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    const { data: job } = await client
      .from("knowledge_ingestion_jobs")
      .select("id")
      .eq("source_id", existingId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return {
      sourceId: existingId,
      jobId: job?.id ?? existingId,
      candidateId: existingCand?.id ?? null,
      duplicate: true,
      published: false,
    };
  }

  const { data: publishedDocs } = await client
    .from("knowledge_documents")
    .select("id, title, fact_status, is_current, source_quality, source_type")
    .eq("org_id", input.orgId)
    .eq("status", "published")
    .is("deleted_at", null)
    .limit(80);
  const publishedIds = (publishedDocs ?? []).map((d) => d.id);
  const bodyByDoc = new Map<string, string>();
  if (publishedIds.length) {
    const { data: versions } = await client
      .from("knowledge_document_versions")
      .select("document_id, body, version_number")
      .in("document_id", publishedIds)
      .is("deleted_at", null);
    const latest = new Map<string, { n: number; body: string }>();
    for (const v of versions ?? []) {
      const prev = latest.get(v.document_id);
      if (!prev || v.version_number > prev.n) {
        latest.set(v.document_id, { n: v.version_number, body: v.body });
      }
    }
    for (const [id, row] of latest) bodyByDoc.set(id, row.body);
  }
  const published = (publishedDocs ?? []).map((d) => ({
    id: d.id,
    title: d.title,
    body: bodyByDoc.get(d.id) ?? d.title,
    factStatus: d.fact_status,
    current: d.is_current,
    sourceQuality: d.source_quality,
    originKind: d.source_type,
  }));

  const records = buildStructuredImportRecords({ item, existingPublished: published });
  const { data: source, error: sErr } = await client
    .from("knowledge_sources")
    .insert({
      ...(input.sourceId ? { id: input.sourceId } : {}),
      org_id: input.orgId,
      name: records.source.name,
      source_type: records.source.source_type,
      origin_kind: records.source.origin_kind,
      raw_text: records.source.raw_text,
      normalized_text: records.source.normalized_text,
      content_hash: records.source.content_hash,
      checksum: records.source.checksum,
      file_object_id: input.fileObjectId ?? null,
      storage_path: input.storagePath ?? null,
      original_filename: input.originalFilename ?? null,
      mime_type: input.mimeType ?? null,
      size_bytes: input.sizeBytes ?? null,
      confidentiality_level: records.source.confidentiality_level,
      visibility: records.source.visibility,
      owner_user_id: input.userId,
      department_id: records.source.department_id,
      project_id: records.source.project_id,
      source_date: records.source.source_date,
      observed_at: new Date().toISOString(),
      metadata: records.source.metadata,
    })
    .select("id")
    .single();
  if (sErr || !source) throw new Error(sErr?.message ?? "source insert failed");

  const { data: job, error: jErr } = await client
    .from("knowledge_ingestion_jobs")
    .insert({
      org_id: input.orgId,
      source_id: source.id,
      status: records.job.status,
      created_by: input.userId,
      total_units: records.job.total_units,
      processed_units: records.job.processed_units,
      failed_units: records.job.failed_units,
      completed_at: new Date().toISOString(),
      budget: DEFAULT_KNOWLEDGE_INGESTION_BUDGET,
    })
    .select("id")
    .single();
  if (jErr || !job) throw new Error(jErr?.message ?? "job insert failed");

  const { data: chunk, error: cErr } = await client
    .from("knowledge_source_chunks")
    .insert({
      org_id: input.orgId,
      source_id: source.id,
      job_id: job.id,
      chunk_index: records.chunk.chunk_index,
      content: records.chunk.content,
      content_hash: records.chunk.content_hash,
      status: records.chunk.status,
    })
    .select("id")
    .single();
  if (cErr || !chunk) throw new Error(cErr?.message ?? "chunk insert failed");

  const { data: candidate, error: candErr } = await client.from("knowledge_candidates").insert({
    org_id: input.orgId,
    title: records.candidate.title,
    content: records.candidate.content,
    content_hash: records.candidate.content_hash,
    suggested_confidentiality_level: records.candidate.suggested_confidentiality_level,
    suggested_visibility: records.candidate.suggested_visibility,
    source_user_id: input.userId,
    source_id: source.id,
    source_chunk_id: chunk.id,
    source_excerpt: records.candidate.source_excerpt,
    candidate_type: records.candidate.candidate_type,
    fact_status: records.candidate.fact_status,
    review_status: records.candidate.review_status,
    domain_keys: records.candidate.domain_keys,
    summary: records.candidate.summary,
    tags: records.candidate.tags,
    conflict_kind: records.candidate.conflict_kind,
    conflict_reason: records.candidate.conflict_reason,
    supersedes_document_id: records.candidate.supersedes_document_id,
    confidence: records.candidate.confidence,
    source_quality: records.candidate.source_quality,
    is_current: records.candidate.is_current,
    valid_from: records.candidate.valid_from,
    valid_until: records.candidate.valid_until,
    source_date: records.candidate.source_date,
    extracted_at: new Date().toISOString(),
    extractor_type: records.candidate.extractor_type,
    extractor_version: records.candidate.extractor_version,
    prompt_version: records.candidate.prompt_version,
    status: records.candidate.status,
  }).select("id").single();
  if (candErr || !candidate) throw new Error(candErr?.message ?? "candidate insert failed");

  return {
    sourceId: source.id,
    jobId: job.id,
    candidateId: candidate.id,
    duplicate: false,
    published: false,
  };
}

export function previewExtractedSource(input: {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}): {
  filename: string;
  title: string;
  text: string;
  limitation: string | null;
  requiresOcr: boolean;
  charCount: number;
} {
  const extracted = extractSourceText({
    mimeType: input.mimeType,
    filename: input.filename,
    bytes: input.bytes,
  });
  return {
    filename: input.filename,
    title: titleFromFilename(input.filename),
    text: extracted.text ?? "",
    limitation: extracted.limitation,
    requiresOcr: Boolean(extracted.requiresOcr || extracted.limitation === "requires_ocr"),
    charCount: (extracted.text ?? "").length,
  };
}

export async function processIngestionJob(
  client: Client,
  input: { jobId: string; access: AccessContext },
): Promise<{
  processed: number;
  total: number;
  failed: number;
  status: string;
  waitingForExtractor?: number;
}> {
  const owner = workerOwner();
  const { data: claimedJob, error: claimErr } = await client.rpc(
    "regapro_claim_knowledge_ingestion_job",
    {
      p_job_id: input.jobId,
      p_lease_seconds: DEFAULT_KNOWLEDGE_EXTRACTION_BUDGET.leaseSeconds,
      p_owner: owner,
    },
  );
  const job =
    claimedJob && !Array.isArray(claimedJob)
      ? claimedJob
      : Array.isArray(claimedJob)
        ? claimedJob[0]
        : null;
  if (claimErr || !job?.id) {
    const { data: existing } = await client
      .from("knowledge_ingestion_jobs")
      .select("*")
      .eq("id", input.jobId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!existing) throw new Error(claimErr?.message ?? "job not found");
    if (existing.status === "paused" || existing.paused_at) {
      return {
        processed: existing.processed_units,
        total: existing.total_units,
        failed: existing.failed_units,
        status: "paused",
      };
    }
    if (existing.cancel_requested || existing.status === "cancelled") {
      return {
        processed: existing.processed_units,
        total: existing.total_units,
        failed: existing.failed_units,
        status: "cancelled",
      };
    }
    return {
      processed: existing.processed_units,
      total: existing.total_units,
      failed: existing.failed_units,
      status: existing.status,
    };
  }
  if (job.status === "cancelled") {
    return {
      processed: job.processed_units,
      total: job.total_units,
      failed: job.failed_units,
      status: "cancelled",
    };
  }

  const { data: source } = await client
    .from("knowledge_sources")
    .select("*")
    .eq("id", job.source_id)
    .single();
  const sourceText = (source?.normalized_text || source?.raw_text || "").trim();
  if (!source || !sourceText) {
    await client
      .from("knowledge_ingestion_jobs")
      .update({
        status: "failed",
        last_error_code: source?.requires_ocr ? "requires_ocr" : "source_text_missing",
        error_summary: source?.requires_ocr ? "requires_ocr" : "source_text_missing",
        lease_expires_at: null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    return { processed: 0, total: 0, failed: 1, status: "failed" };
  }

  const budget = DEFAULT_KNOWLEDGE_INGESTION_BUDGET;
  const drafts = splitKnowledgeBody(sourceText, {
    maxChars: budget.maxCharsPerSourceChunk,
    overlapChars: budget.overlapChars,
    minChars: budget.minChars,
  });

  if ((job.total_units ?? 0) === 0) {
    for (const draft of drafts) {
      await upsertSourceChunk(client, {
        org_id: job.org_id,
        source_id: source.id,
        job_id: job.id,
        chunk_index: draft.chunkIndex,
        content: draft.content,
        content_hash: draft.contentHash,
        status: "pending",
      });
    }
    await client
      .from("knowledge_ingestion_jobs")
      .update({
        total_units: drafts.length,
        status: "processing",
        started_at: job.started_at ?? new Date().toISOString(),
      })
      .eq("id", job.id);
  }

  const generate = createKnowledgeExtractionGenerate({
    access: input.access,
    confidentialityLevel: confidentialityFromRank(source.confidentiality_level),
    chunkTitle: source.name,
    chunkText: sourceText.slice(0, 500),
  });
  const extractor = new LlmKnowledgeExtractionProvider(
    generate,
    new PostgresKnowledgeExtractionCache(client, job.org_id),
  );

  const { data: claimedChunks, error: chunkClaimErr } = await client.rpc(
    "regapro_claim_knowledge_source_chunks",
    {
      p_job_id: job.id,
      p_limit: budget.maxUnitsPerTick,
      p_lease_seconds: DEFAULT_KNOWLEDGE_EXTRACTION_BUDGET.leaseSeconds,
      p_include_waiting: Boolean(generate),
    },
  );
  let pending = (claimedChunks ?? []) as Array<{
    id: string;
    chunk_index: number;
    content: string;
    content_hash: string;
    attempt_count: number;
  }>;
  if (chunkClaimErr || pending.length === 0) {
    const { data: fallback } = await client
      .from("knowledge_source_chunks")
      .select("id, chunk_index, content, content_hash, attempt_count")
      .eq("source_id", source.id)
      .in("status", generate ? ["pending", "retryable", "waiting_for_extractor"] : ["pending", "retryable"])
      .is("deleted_at", null)
      .order("chunk_index", { ascending: true })
      .limit(budget.maxUnitsPerTick);
    pending = fallback ?? [];
  }

  const guard = new KnowledgeIngestionBudgetGuard(budget);
  const meta = (source.metadata ?? {}) as {
    question?: string | null;
    answer?: string | null;
    domainKeys?: string[];
  };

  const { data: publishedDocs } = await client
    .from("knowledge_documents")
    .select("id, title, fact_status, is_current, source_quality, source_type")
    .eq("org_id", job.org_id)
    .eq("status", "published")
    .is("deleted_at", null)
    .limit(80);
  const publishedIds = (publishedDocs ?? []).map((d) => d.id);
  const bodyByDoc = new Map<string, string>();
  if (publishedIds.length) {
    const { data: versions } = await client
      .from("knowledge_document_versions")
      .select("document_id, body, version_number")
      .in("document_id", publishedIds)
      .is("deleted_at", null);
    const latest = new Map<string, { n: number; body: string }>();
    for (const v of versions ?? []) {
      const prev = latest.get(v.document_id);
      if (!prev || v.version_number > prev.n) {
        latest.set(v.document_id, { n: v.version_number, body: v.body });
      }
    }
    for (const [id, row] of latest) bodyByDoc.set(id, row.body);
  }
  const published = (publishedDocs ?? []).map((d) => ({
    id: d.id,
    title: d.title,
    body: bodyByDoc.get(d.id) ?? d.title,
    factStatus: d.fact_status,
    current: d.is_current,
    sourceQuality: d.source_quality,
    originKind: d.source_type,
  }));

  let processed = 0;
  let failed = 0;
  let waiting = 0;
  let modelCalls = job.model_calls ?? 0;
  let estimatedTokens = job.estimated_tokens ?? 0;
  let estimatedCost = Number(job.estimated_cost_usd ?? 0);
  const originKind = (source.origin_kind ?? "paste") as KnowledgeOriginKind;
  const qaOnce = originKind === "qa" && Boolean(meta.question && meta.answer);
  const maxAttempts = budget.maxRetries + 1;
  const started = Date.now();

  for (const unit of pending) {
    if (!guard.takeUnitTick(processed + failed + waiting)) break;
    if ((unit.attempt_count ?? 0) > maxAttempts) {
      failed += 1;
      await client
        .from("knowledge_source_chunks")
        .update({
          status: "failed",
          error_code: "poison_chunk",
          last_error_code: "poison_chunk",
          lease_expires_at: null,
        })
        .eq("id", unit.id);
      continue;
    }
    try {
      const outcome = await extractor.extractChunk({
        originKind,
        title: source.name,
        chunkId: unit.id,
        chunkText: unit.content,
        chunkHash: unit.content_hash,
        chunkIndex: unit.chunk_index,
        visibility: source.visibility,
        domainKeys: meta.domainKeys,
        question: qaOnce ? meta.question : originKind === "qa" ? meta.question : null,
        answer: qaOnce ? meta.answer : originKind === "qa" ? meta.answer : null,
        containsPersonalConversation: source.contains_personal_conversation,
        needsReasoning: false,
      });
      if (outcome.status === "waiting_for_extractor") {
        waiting += 1;
        await client
          .from("knowledge_source_chunks")
          .update({
            status: "waiting_for_extractor",
            error_code: outcome.reason,
            last_error_code: outcome.reason,
            lease_expires_at: null,
          })
          .eq("id", unit.id);
        continue;
      }
      if (outcome.status === "invalid") {
        const poison = (unit.attempt_count ?? 1) >= maxAttempts;
        failed += 1;
        await client
          .from("knowledge_source_chunks")
          .update({
            status: poison ? "failed" : "retryable",
            error_code: poison ? "poison_chunk" : "invalid_extraction",
            last_error_code: outcome.reason.slice(0, 80),
            next_attempt_at: poison
              ? null
              : new Date(Date.now() + 30_000).toISOString(),
            lease_expires_at: null,
          })
          .eq("id", unit.id);
        continue;
      }

      const draftsOut = outcome.status === "skipped_private" ? [] : outcome.drafts;
      const toInsert = qaOnce && unit.chunk_index > 0 ? [] : draftsOut;
      for (const cand of toInsert) {
        const conflict = classifyKnowledgeConflict({
          title: cand.title,
          body: cand.content,
          factStatus: cand.factStatus,
          isCurrent: cand.isCurrent,
          sourceQuality: cand.sourceQuality,
          originKind,
          existing: published,
        });
        const reviewStatus: KnowledgeReviewStatus =
          conflict.kind === "duplicate"
            ? "duplicate"
            : conflict.kind === "conflict"
              ? "conflict"
              : conflict.kind === "supersession"
                ? "possible_update"
                : "new";
        const contentHash = sha256Hex(cand.content);
        const { error: candErr } = await client.from("knowledge_candidates").insert({
          org_id: job.org_id,
          title: cand.title.slice(0, 200),
          content: cand.content.slice(0, 8_000),
          content_hash: contentHash,
          suggested_confidentiality_level: source.confidentiality_level,
          suggested_visibility: source.visibility,
          source_thread_id: source.origin_thread_id,
          source_user_id: input.access.userId,
          source_id: source.id,
          source_chunk_id: unit.id,
          source_excerpt: cand.excerpt,
          candidate_type: cand.candidateType,
          fact_status: cand.factStatus,
          review_status: reviewStatus,
          domain_keys: cand.domainKeys,
          summary: cand.summary,
          applicability: cand.applicability,
          exceptions: cand.exceptions,
          paraphrases: cand.paraphrases,
          tags: cand.tags,
          conflict_kind: conflict.kind,
          conflict_reason: conflict.reason,
          supersedes_document_id: conflict.existingId,
          confidence: cand.confidence,
          source_quality: cand.sourceQuality,
          is_current: cand.isCurrent ?? cand.factStatus !== "historical",
          valid_from: cand.validFrom ?? null,
          valid_until: cand.validUntil ?? null,
          extracted_at: new Date().toISOString(),
          extractor_type: cand.extractorType ?? (outcome.status === "extracted" ? outcome.extractorType : "heuristic"),
          extractor_version:
            cand.extractorVersion ??
            (outcome.status === "extracted" ? outcome.extractorVersion : "heuristic-v1"),
          model_role: cand.modelRole ?? (outcome.status === "extracted" ? outcome.modelRole : null),
          model_id: cand.modelId ?? (outcome.status === "extracted" ? outcome.modelId : null),
          prompt_version:
            cand.promptVersion ??
            (outcome.status === "extracted" ? outcome.promptVersion : "heuristic-v1"),
          status: "draft",
          contains_personal_conversation: source.contains_personal_conversation,
        });
        if (candErr && !/duplicate|unique/i.test(candErr.message)) {
          throw new Error(candErr.message);
        }
        if (cand.candidateType === "fact" || cand.candidateType === "qa") {
          await client.from("knowledge_facts").insert({
            org_id: job.org_id,
            fact_text: cand.summary.slice(0, 2000),
            confidence: cand.confidence,
            candidate_id: null,
            source_id: source.id,
            source_chunk_id: unit.id,
            fact_type: cand.candidateType,
            fact_status: cand.factStatus,
            excerpt: cand.excerpt,
          });
        }
      }
      if (outcome.status === "extracted" && outcome.usage) {
        modelCalls += 1;
        estimatedTokens += outcome.usage.totalTokens;
        estimatedCost += outcome.estimatedCostUsd ?? 0;
      }
      const confidentiality = confidentialityFromRank(source.confidentiality_level);
      const privateOrElevated =
        source.visibility === "private" ||
        confidentiality === "people" ||
        confidentiality === "executive";
      void emitRuntimeTrace({
        name: "regapro.knowledge.extract",
        requestId: job.id,
        intent: "knowledge_extraction",
        selectedModelRole: outcome.status === "extracted" ? outcome.modelRole : null,
        actualModelId: outcome.status === "extracted" ? outcome.modelId ?? undefined : undefined,
        latencyMs: Date.now() - started,
        tokenUsage: outcome.status === "extracted" ? outcome.usage ?? null : null,
        estimatedCostUsd: outcome.status === "extracted" ? outcome.estimatedCostUsd ?? null : null,
        success: outcome.status === "extracted" || outcome.status === "skipped_private",
        confidentialityLevel: confidentiality,
        evaluationTags: [
          `source:${source.id}`,
          `job:${job.id}`,
          `chunk:${unit.id}`,
          `extractor:${outcome.status === "extracted" ? outcome.extractorVersion : "none"}`,
          `candidates:${outcome.status === "extracted" ? outcome.drafts.length : 0}`,
        ],
        ...(privateOrElevated ? {} : { output: { candidateCount: toInsert.length } }),
      });
      await client
        .from("knowledge_source_chunks")
        .update({
          status: "completed",
          extracted_at: new Date().toISOString(),
          lease_expires_at: null,
          last_error_code: null,
        })
        .eq("id", unit.id);
      processed += 1;
    } catch {
      const poison = (unit.attempt_count ?? 1) >= maxAttempts;
      failed += 1;
      await client
        .from("knowledge_source_chunks")
        .update({
          status: poison ? "failed" : "retryable",
          error_code: poison ? "poison_chunk" : "extract_failed",
          last_error_code: poison ? "poison_chunk" : "extract_failed",
          next_attempt_at: poison ? null : new Date(Date.now() + 30_000).toISOString(),
          lease_expires_at: null,
        })
        .eq("id", unit.id);
    }
  }

  if (qaOnce && processed > 0) {
    await client
      .from("knowledge_source_chunks")
      .update({
        status: "completed",
        extracted_at: new Date().toISOString(),
        lease_expires_at: null,
      })
      .eq("source_id", source.id)
      .in("status", ["pending", "retryable"]);
  }

  const openStatuses = generate
    ? ["pending", "retryable", "processing", "waiting_for_extractor"]
    : ["pending", "retryable", "processing"];
  const { count: remaining } = await client
    .from("knowledge_source_chunks")
    .select("id", { count: "exact", head: true })
    .eq("source_id", source.id)
    .in("status", openStatuses)
    .is("deleted_at", null);
  const { count: waitingCount } = await client
    .from("knowledge_source_chunks")
    .select("id", { count: "exact", head: true })
    .eq("source_id", source.id)
    .eq("status", "waiting_for_extractor")
    .is("deleted_at", null);

  const total = drafts.length || job.total_units;
  const processedUnits = (job.processed_units ?? 0) + processed;
  const failedUnits = (job.failed_units ?? 0) + failed;
  const done = (remaining ?? 0) === 0;
  const status = done
    ? failedUnits > 0 && processedUnits === 0
      ? "failed"
      : "completed"
    : (waitingCount ?? 0) > 0 && processed === 0 && failed === 0
      ? "processing"
      : "processing";
  await client
    .from("knowledge_ingestion_jobs")
    .update({
      processed_units: processedUnits,
      failed_units: failedUnits,
      cursor_index: processedUnits,
      total_units: total,
      status,
      completed_at: done ? new Date().toISOString() : null,
      error_summary: failed
        ? "unit_extract_failed"
        : (waitingCount ?? 0) > 0
          ? "waiting_for_extractor"
          : null,
      last_error_code: failed ? "unit_extract_failed" : null,
      lease_expires_at: done ? null : job.lease_expires_at,
      model_calls: modelCalls,
      estimated_tokens: estimatedTokens,
      estimated_cost_usd: estimatedCost,
    })
    .eq("id", job.id);

  return {
    processed: processedUnits,
    total,
    failed: failedUnits,
    status,
    waitingForExtractor: waitingCount ?? waiting,
  };
}

export async function processIngestionJobUntilIdle(
  client: Client,
  input: { jobId: string; access: AccessContext; maxTicks?: number },
) {
  let last = await processIngestionJob(client, input);
  const maxTicks = input.maxTicks ?? 4;
  let ticks = 1;
  while (last.status === "processing" && ticks < maxTicks) {
    last = await processIngestionJob(client, input);
    ticks += 1;
  }
  return last;
}

export async function pauseIngestionJob(client: Client, jobId: string) {
  const { error } = await client
    .from("knowledge_ingestion_jobs")
    .update({
      status: "paused",
      paused_at: new Date().toISOString(),
      lease_expires_at: null,
    })
    .eq("id", jobId)
    .in("status", ["pending", "processing"]);
  if (error) throw new Error(error.message);
}

export async function resumeIngestionJob(
  client: Client,
  input: { jobId: string; access: AccessContext },
) {
  await client
    .from("knowledge_ingestion_jobs")
    .update({
      status: "pending",
      paused_at: null,
      cancel_requested: false,
      next_attempt_at: null,
    })
    .eq("id", input.jobId)
    .in("status", ["paused", "failed", "processing"]);
  return processIngestionJob(client, input);
}

export async function retryFailedIngestionChunks(
  client: Client,
  input: { jobId: string; access: AccessContext },
) {
  const { data: job } = await client
    .from("knowledge_ingestion_jobs")
    .select("source_id")
    .eq("id", input.jobId)
    .maybeSingle();
  if (!job) throw new Error("job not found");
  await client
    .from("knowledge_source_chunks")
    .update({
      status: "retryable",
      next_attempt_at: null,
      last_error_code: null,
      lease_expires_at: null,
    })
    .eq("job_id", input.jobId)
    .in("status", ["failed", "retryable"]);
  await client
    .from("knowledge_ingestion_jobs")
    .update({
      status: "pending",
      paused_at: null,
      completed_at: null,
      error_summary: null,
    })
    .eq("id", input.jobId);
  return processIngestionJob(client, input);
}

export async function cancelIngestionJob(client: Client, jobId: string) {
  await client
    .from("knowledge_ingestion_jobs")
    .update({
      cancel_requested: true,
      status: "cancelled",
      lease_expires_at: null,
      completed_at: new Date().toISOString(),
      error_summary: "cancelled_future_work",
    })
    .eq("id", jobId);
  await client
    .from("knowledge_source_chunks")
    .update({
      status: "failed",
      error_code: "cancelled",
      last_error_code: "cancelled",
      lease_expires_at: null,
    })
    .eq("job_id", jobId)
    .in("status", ["pending", "retryable", "waiting_for_extractor", "processing"]);
}

export async function previewSourceDelete(client: Client, sourceId: string) {
  const { count: publishedDocumentCount } = await client
    .from("knowledge_documents")
    .select("id", { count: "exact", head: true })
    .eq("source_id", sourceId)
    .eq("status", "published")
    .is("deleted_at", null);
  const { count: candidateCount } = await client
    .from("knowledge_candidates")
    .select("id", { count: "exact", head: true })
    .eq("source_id", sourceId)
    .is("deleted_at", null);
  return planKnowledgeSourceDelete({
    publishedDocumentCount: publishedDocumentCount ?? 0,
    candidateCount: candidateCount ?? 0,
  });
}

export async function deleteKnowledgeSource(
  client: Client,
  input: { sourceId: string; access: AccessContext; confirm: boolean },
) {
  requireWrite(input.access);
  const plan = await previewSourceDelete(client, input.sourceId);
  if (!input.confirm) return plan;
  await client
    .from("knowledge_sources")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", input.sourceId);
  return { ...plan, deleted: true };
}

export async function listIngestionJobs(client: Client, orgId: string) {
  const { data, error } = await client
    .from("knowledge_ingestion_jobs")
    .select(
      "id, source_id, status, total_units, processed_units, failed_units, cursor_index, error_summary, last_error_code, started_at, completed_at, created_at, model_calls, estimated_tokens, estimated_cost_usd, paused_at, cancel_requested",
    )
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function listReviewInbox(
  client: Client,
  orgId: string,
  filters?: {
    status?: KnowledgeReviewStatus;
    domain?: string;
    sourceId?: string;
    jobId?: string;
    conflict?: string;
    current?: boolean;
    q?: string;
  },
) {
  let q = client
    .from("knowledge_candidates")
    .select(
      "id, title, summary, candidate_type, fact_status, review_status, conflict_kind, conflict_reason, domain_keys, source_excerpt, source_quality, confidence, suggested_visibility, suggested_confidentiality_level, supersedes_document_id, created_at, source_id, extractor_type, extractor_version, extracted_at, is_current, model_role",
    )
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(100);
  if (filters?.status) q = q.eq("review_status", filters.status);
  if (filters?.domain) q = q.contains("domain_keys", [filters.domain]);
  if (filters?.sourceId) q = q.eq("source_id", filters.sourceId);
  if (filters?.conflict) q = q.eq("conflict_kind", filters.conflict);
  if (filters?.current != null) q = q.eq("is_current", filters.current);
  if (filters?.q) q = q.ilike("title", `%${filters.q}%`);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function reviewCandidate(
  client: Client,
  input: {
    access: AccessContext;
    candidateId: string;
    action: "approve" | "edit_approve" | "reject" | "merge" | "mark_duplicate" | "supersede";
    title?: string;
    content?: string;
    visibility?: Visibility;
    comment?: string;
  },
): Promise<{ documentId?: string; alreadyPublished?: boolean; published?: boolean }> {
  requireReview(input.access);
  if (reviewInFlight.has(input.candidateId)) {
    throw new Error("ALREADY_IN_FLIGHT");
  }
  reviewInFlight.add(input.candidateId);
  try {
    return await reviewCandidateUnlocked(client, input);
  } finally {
    reviewInFlight.delete(input.candidateId);
  }
}

async function reviewCandidateUnlocked(
  client: Client,
  input: {
    access: AccessContext;
    candidateId: string;
    action: "approve" | "edit_approve" | "reject" | "merge" | "mark_duplicate" | "supersede";
    title?: string;
    content?: string;
    visibility?: Visibility;
    comment?: string;
  },
): Promise<{ documentId?: string; alreadyPublished?: boolean; published?: boolean }> {
  const { data: cand, error } = await client
    .from("knowledge_candidates")
    .select("*")
    .eq("id", input.candidateId)
    .single();
  if (error || !cand) throw new Error("CANDIDATE_NOT_FOUND");

  const decision = decideKnowledgeReview({
    permissionKeys: input.access.permissionKeys,
    action: input.action,
    candidate: {
      reviewStatus: cand.review_status,
      conflictKind: cand.conflict_kind,
      publishedDocumentId: cand.published_document_id,
      suggestedVisibility: cand.suggested_visibility,
      confidence: cand.confidence,
      sourceQuality: cand.source_quality,
    },
  });
  if (decision.kind === "forbidden") throw new Error(decision.code);
  if (decision.kind === "not_found") throw new Error(decision.code);
  if (decision.kind === "idempotent") {
    return { documentId: decision.documentId, alreadyPublished: true, published: true };
  }
  if (decision.kind === "conflict_supersede_required") {
    throw new Error(decision.code);
  }

  const sourceVis = cand.suggested_visibility ?? "organization";
  const targetVis = input.visibility ?? cand.confirmed_visibility ?? sourceVis;
  const sourceLevel = confidentialityFromRank(
    cand.confirmed_confidentiality_level ?? cand.suggested_confidentiality_level,
  );
  if (input.action === "approve" || input.action === "edit_approve" || input.action === "supersede") {
    assertNoSecurityPromotion({
      sourceVisibility: sourceVis,
      targetVisibility: targetVis,
      sourceLevel,
      targetLevel: sourceLevel,
    });
  }

  const { error: reviewErr } = await client.from("knowledge_candidate_reviews").insert({
    org_id: cand.org_id,
    candidate_id: cand.id,
    reviewer_id: input.access.userId,
    action: input.action,
    comment: input.comment ?? null,
  });
  throwIfError(reviewErr, "review insert failed");

  if (input.action === "reject" || input.action === "mark_duplicate") {
    const { error: rejErr } = await client
      .from("knowledge_candidates")
      .update({
        review_status: input.action === "reject" ? "rejected" : "duplicate",
        status: "rejected",
      })
      .eq("id", cand.id);
    throwIfError(rejErr, "candidate reject failed");
    return { published: false };
  }

  const title = (input.title ?? cand.title).slice(0, 200);
  const body = input.content ?? cand.content;
  const { data: source } = cand.source_id
    ? await client.from("knowledge_sources").select("id").eq("id", cand.source_id).maybeSingle()
    : { data: null };

  let sourceId = source?.id as string | undefined;
  if (!sourceId) {
    const created = await client
      .from("knowledge_sources")
      .insert({
        org_id: cand.org_id,
        name: title,
        source_type: "manual",
        origin_kind: "manual",
        owner_user_id: input.access.userId,
      })
      .select("id")
      .single();
    throwIfError(created.error, "source required");
    sourceId = created.data?.id;
  }
  if (!sourceId) throw new Error("source required");

  const { data: existingDoc } = await client
    .from("knowledge_documents")
    .select("id, status")
    .eq("candidate_id", cand.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (existingDoc?.id && existingDoc.status === "published") {
    const { error: linkErr } = await client
      .from("knowledge_candidates")
      .update({
        review_status: "approved",
        status: "approved",
        published_document_id: existingDoc.id,
        confirmed_visibility: targetVis,
      })
      .eq("id", cand.id);
    throwIfError(linkErr, "candidate link failed");
    return { documentId: existingDoc.id, alreadyPublished: true, published: true };
  }

  const { data: doc, error: dErr } = existingDoc?.id
    ? { data: { id: existingDoc.id }, error: null }
    : await client
        .from("knowledge_documents")
        .insert({
          org_id: cand.org_id,
          source_id: sourceId,
          title,
          status: "approved",
          content_hash: sha256Hex(body),
          confidentiality_level: cand.suggested_confidentiality_level,
          visibility: targetVis,
          owner_user_id: input.access.userId,
          source_type: "manual",
          candidate_id: cand.id,
          domain_keys: cand.domain_keys ?? ["company_common"],
          fact_status: cand.fact_status,
          is_current: cand.fact_status !== "historical",
          source_quality: cand.source_quality,
          supersedes_id: input.action === "supersede" ? cand.supersedes_document_id : null,
          embedding_status: "pending",
        })
        .select("id")
        .single();
  if (dErr || !doc) throw new Error(dErr?.message ?? "document insert failed");

  const { data: existingVersion } = await client
    .from("knowledge_document_versions")
    .select("id")
    .eq("document_id", doc.id)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  if (!existingVersion?.id) {
    const { error: vErr } = await client.from("knowledge_document_versions").insert({
      document_id: doc.id,
      version_number: 1,
      body,
      created_by: input.access.userId,
    });
    throwIfError(vErr, "version insert failed");
  }

  for (const key of cand.domain_keys ?? ["company_common"]) {
    const { error: domErr } = await client.from("knowledge_document_domains").insert({
      document_id: doc.id,
      domain_key: key,
      org_id: cand.org_id,
    });
    if (domErr && !/duplicate|unique/i.test(domErr.message)) {
      throw new Error(domErr.message);
    }
  }

  if (input.action === "supersede" && cand.supersedes_document_id) {
    const { error: supErr } = await client
      .from("knowledge_documents")
      .update({
        status: "superseded",
        is_current: false,
        fact_status: "historical",
        superseded_by_id: doc.id,
      })
      .eq("id", cand.supersedes_document_id);
    throwIfError(supErr, "supersede update failed");
  }

  const { error: pubErr } = await client
    .from("knowledge_documents")
    .update({ status: "published", published_at: new Date().toISOString() })
    .eq("id", doc.id);
  throwIfError(pubErr, "publish update failed");

  try {
    const ingest = await withTimeout(
      ingestPublishedDocumentChunks(client, {
        documentId: doc.id,
        embedding: createEmbeddingProvider(),
      }),
      90_000,
      "EMBEDDING_TIMEOUT",
    );
    const embedding = createEmbeddingProvider();
    const embeddingStatus = resolveEmbeddingPublishStatus({
      available: embedding.available,
      embedded: ingest.embedded,
    });
    if (embeddingStatus === "failed") {
      throw new Error("EMBEDDING_FAILED");
    }
    const { error: embErr } = await client
      .from("knowledge_documents")
      .update({ embedding_status: embeddingStatus })
      .eq("id", doc.id);
    throwIfError(embErr, "embedding status update failed");
  } catch (err) {
    const code =
      err instanceof Error && /EMBEDDING_/.test(err.message)
        ? err.message
        : err instanceof Error
          ? err.message
          : "EMBEDDING_FAILED";
    await client
      .from("knowledge_documents")
      .update({ status: "approved", published_at: null, embedding_status: "failed" })
      .eq("id", doc.id);
    throw new Error(code);
  }

  const { error: candErr } = await client
    .from("knowledge_candidates")
    .update({
      review_status: "approved",
      status: "approved",
      published_document_id: doc.id,
      confirmed_visibility: targetVis,
    })
    .eq("id", cand.id);
  throwIfError(candErr, "candidate approve failed");

  return { documentId: doc.id, published: true };
}

export async function batchReviewCandidates(
  client: Client,
  input: {
    access: AccessContext;
    candidateIds: string[];
    action: "approve" | "reject";
  },
): Promise<{ ok: string[]; skipped: string[]; failed: Array<{ id: string; error: string }> }> {
  requireReview(input.access);
  const { data: rows, error: listErr } = await client
    .from("knowledge_candidates")
    .select(
      "id, review_status, conflict_kind, suggested_visibility, confidence, source_quality, published_document_id",
    )
    .in("id", input.candidateIds);
  throwIfError(listErr, "candidate list failed");
  const candidatesById: Record<
    string,
    {
      reviewStatus: string;
      conflictKind: string;
      publishedDocumentId?: string | null;
      suggestedVisibility?: string | null;
      confidence?: number | null;
      sourceQuality?: number | null;
    }
  > = {};
  for (const row of rows ?? []) {
    candidatesById[row.id] = {
      reviewStatus: row.review_status,
      conflictKind: row.conflict_kind,
      publishedDocumentId: row.published_document_id,
      suggestedVisibility: row.suggested_visibility,
      confidence: row.confidence,
      sourceQuality: row.source_quality,
    };
  }
  const plan = planBatchKnowledgeReview({
    permissionKeys: input.access.permissionKeys,
    action: input.action,
    selectedIds: input.candidateIds,
    candidatesById,
  });
  const ok: string[] = [];
  const skipped = plan.skipped.map((s) => s.id);
  const failed: Array<{ id: string; error: string }> = [];
  for (const id of plan.toRun) {
    try {
      await reviewCandidate(client, {
        access: input.access,
        candidateId: id,
        action: input.action === "approve" ? "approve" : "reject",
      });
      ok.push(id);
    } catch (err) {
      failed.push({
        id,
        error: knowledgeReviewErrorMessage(err instanceof Error ? err.message : "failed"),
      });
    }
  }
  return { ok, skipped, failed };
}

export async function retryDocumentEmbedding(
  client: Client,
  documentId: string,
): Promise<{ embedded: boolean }> {
  await client
    .from("knowledge_documents")
    .update({ status: "published", published_at: new Date().toISOString() })
    .eq("id", documentId);
  const result = await ingestPublishedDocumentChunks(client, {
    documentId,
    embedding: createEmbeddingProvider(),
  });
  if (!result.embedded) {
    await client
      .from("knowledge_documents")
      .update({
        embedding_status: "failed",
        status: "approved",
        published_at: null,
      })
      .eq("id", documentId);
    return { embedded: false };
  }
  await client
    .from("knowledge_documents")
    .update({
      embedding_status: "ready",
      status: "published",
    })
    .eq("id", documentId);
  return { embedded: true };
}

export async function captureConversationCandidate(
  client: Client,
  input: {
    access: AccessContext;
    threadId: string;
    messageId?: string | null;
    userQuestion: string;
    assistantAnswer: string;
    evidenceTitles: string[];
    instruction: string;
    visibility: string;
    containsPersonalConversation: boolean;
  },
): Promise<{ id: string } | null> {
  if (!isKnowledgeCaptureUtterance(input.instruction) && input.instruction !== "ナレッジ候補") {
    // button path uses a short title
  }
  const plan = planConversationCapture({
    userQuestion: input.userQuestion,
    assistantAnswer: input.assistantAnswer,
    evidenceTitles: input.evidenceTitles,
    instruction: input.instruction,
    visibility: input.visibility,
    containsPersonalConversation: input.containsPersonalConversation,
  });
  if (!plan.allowed) return null;

  const created = await createKnowledgeSourceAndJob(client, {
    orgId: input.access.organizationId,
    userId: input.access.userId,
    access: input.access,
    originKind: "conversation",
    title: plan.title,
    text: plan.content,
    confidentialityLevel: input.access.threadConfidentialityLevel,
    visibility: input.visibility as Visibility,
    originThreadId: input.threadId,
    originMessageId: input.messageId ?? null,
    containsPersonalConversation: false,
    domainKeys: ["company_common"],
    captureMode: true,
  });
  if (!created.duplicate) {
    await processIngestionJob(client, { jobId: created.jobId, access: input.access });
  }
  return { id: created.sourceId };
}

export async function factoryCounts(client: Client, orgId: string) {
  const tables = [
    "knowledge_sources",
    "knowledge_ingestion_jobs",
    "knowledge_candidates",
    "knowledge_documents",
    "knowledge_chunks",
  ] as const;
  const out: Record<string, number> = {};
  for (const t of tables) {
    const { count } = await client
      .from(t)
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .is("deleted_at", null);
    out[t] = count ?? 0;
  }
  const { count: published } = await client
    .from("knowledge_documents")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("status", "published")
    .is("deleted_at", null);
  const { count: approved } = await client
    .from("knowledge_candidates")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("review_status", "approved")
    .is("deleted_at", null);
  const { count: duplicates } = await client
    .from("knowledge_candidates")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("review_status", "duplicate")
    .is("deleted_at", null);
  const { count: conflicts } = await client
    .from("knowledge_candidates")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("review_status", "conflict")
    .is("deleted_at", null);
  const { count: failedJobs } = await client
    .from("knowledge_ingestion_jobs")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("status", "failed")
    .is("deleted_at", null);
  const { count: embedded } = await client
    .from("knowledge_chunks")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .not("embedding", "is", null)
    .is("deleted_at", null);
  return {
    sources: out.knowledge_sources ?? 0,
    jobs: out.knowledge_ingestion_jobs ?? 0,
    candidates: out.knowledge_candidates ?? 0,
    approved: approved ?? 0,
    published: published ?? 0,
    chunks: out.knowledge_chunks ?? 0,
    embeddings: embedded ?? 0,
    duplicates: duplicates ?? 0,
    conflicts: conflicts ?? 0,
    failedJobs: failedJobs ?? 0,
  };
}

export { extractSourceText };

export async function ingestUrlSource(
  client: Client,
  input: FactorySourceInput & { url: string },
): Promise<{ sourceId: string; jobId: string; duplicate: boolean; limitation: string | null }> {
  const deps = createWebIntelligenceDeps(process.env);
  let text = input.text;
  let title = input.title;
  let canonical = input.canonicalUrl ?? input.url;
  let domain = input.domain ?? domainFromUrl(input.url);
  let limitation: string | null = null;
  if (!text.trim()) {
    const page = await deps.content.fetchPage({ url: input.url });
    if (page?.extractedText || page?.snippet) {
      text = page.extractedText || page.snippet;
      title = page.title || title;
      canonical = page.canonicalUrl || canonical;
      domain = page.domain || domain;
    } else {
      limitation = deps.content.connected ? "url_fetch_empty" : "url_fetch_disconnected";
    }
  }
  const created = await createKnowledgeSourceAndJob(client, {
    ...input,
    originKind: "url",
    title,
    text: text || input.url,
    url: input.url,
    canonicalUrl: canonical,
    domain,
  });
  if (limitation && !created.duplicate) {
    await client
      .from("knowledge_ingestion_jobs")
      .update({
        status: "failed",
        error_summary: limitation,
        completed_at: new Date().toISOString(),
      })
      .eq("id", created.jobId);
  }
  return { ...created, limitation };
}

export async function ingestFileSource(
  client: Client,
  input: {
    access: AccessContext;
    filename: string;
    mimeType: string;
    bytes: Uint8Array;
    originKind?: KnowledgeOriginKind;
    domainKeys?: string[];
    confidentialityLevel?: ConfidentialityLevel;
    visibility?: Visibility;
    title?: string;
    importMode?: "structured" | "source" | "qa";
  },
): Promise<{
  name: string;
  ok: boolean;
  sourceId?: string;
  jobId?: string;
  duplicate?: boolean;
  error?: string;
  requiresOcr?: boolean;
}> {
  const extracted = extractSourceText({
    mimeType: input.mimeType,
    filename: input.filename,
    bytes: input.bytes,
  });
  const sourceId = globalThis.crypto.randomUUID();
  const title = (input.title?.trim() || titleFromFilename(input.filename)).slice(0, 200);
  const structured =
    input.importMode === "structured" || input.originKind === "authoritative_seed";
  let stored: { fileObjectId: string; path: string; checksum: string; size: number } | null =
    null;
  try {
    stored = await storeKnowledgeSourceOriginal({
      client,
      orgId: input.access.organizationId,
      userId: input.access.userId,
      sourceId,
      filename: input.filename,
      mimeType: input.mimeType || "application/octet-stream",
      bytes: input.bytes,
      confidentialityLevel: input.confidentialityLevel ?? "company",
      visibility: input.visibility ?? "organization",
    });
  } catch (err) {
    return {
      name: input.filename,
      ok: false,
      error: err instanceof Error ? err.message : "storage_failed",
    };
  }

  const common = {
    orgId: input.access.organizationId,
    userId: input.access.userId,
    access: input.access,
    sourceId,
    originKind: input.originKind ?? "file",
    title,
    fileObjectId: stored.fileObjectId,
    storagePath: stored.path,
    originalFilename: input.filename,
    mimeType: input.mimeType,
    sizeBytes: stored.size,
    checksum: stored.checksum,
    confidentialityLevel: input.confidentialityLevel ?? "company",
    visibility: input.visibility ?? "organization",
    domainKeys: input.domainKeys ?? ["company_common"],
    importMode: input.importMode,
  } as const;

  if (!extracted.text) {
    try {
      const created = await createKnowledgeSourceAndJob(client, {
        ...common,
        text: "",
        requiresOcr: Boolean(extracted.requiresOcr || extracted.limitation === "requires_ocr"),
      });
      return {
        name: input.filename,
        ok: false,
        sourceId: created.sourceId,
        jobId: created.jobId,
        requiresOcr: true,
        error: extracted.limitation ?? "extract_failed",
      };
    } catch (err) {
      await compensateKnowledgeSourceOrphan({
        client,
        fileObjectId: stored.fileObjectId,
        path: stored.path,
      });
      return {
        name: input.filename,
        ok: false,
        error: err instanceof Error ? err.message : "source_insert_failed",
      };
    }
  }

  try {
    if (structured) {
      const created = await createStructuredKnowledgeItem(client, {
        ...common,
        text: extracted.text,
        importMode: "structured",
      });
      return {
        name: input.filename,
        ok: true,
        sourceId: created.sourceId,
        jobId: created.jobId,
        duplicate: created.duplicate,
      };
    }
    const created = await createKnowledgeSourceAndJob(client, {
      ...common,
      text: extracted.text,
    });
    if (!created.duplicate) {
      await processIngestionJob(client, {
        jobId: created.jobId,
        access: input.access,
      });
    }
    return {
      name: input.filename,
      ok: true,
      sourceId: created.sourceId,
      jobId: created.jobId,
      duplicate: created.duplicate,
    };
  } catch (err) {
    await compensateKnowledgeSourceOrphan({
      client,
      fileObjectId: stored.fileObjectId,
      path: stored.path,
    });
    return {
      name: input.filename,
      ok: false,
      error: err instanceof Error ? err.message : "failed",
    };
  }
}
