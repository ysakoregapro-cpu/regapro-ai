import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_KNOWLEDGE_INGESTION_BUDGET,
  HeuristicKnowledgeExtractor,
  KnowledgeIngestionBudgetGuard,
  assertNoSecurityPromotion,
  canBatchApprove,
  classifyKnowledgeConflict,
  extractSourceText,
  isKnowledgeCaptureUtterance,
  planConversationCapture,
  sha256Hex,
  splitKnowledgeBody,
  type KnowledgeOriginKind,
  type KnowledgeReviewStatus,
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<Database, "public", any>;

export type FactorySourceInput = {
  orgId: string;
  userId: string;
  access: AccessContext;
  originKind: KnowledgeOriginKind;
  title: string;
  text: string;
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
  if (
    !access.permissionKeys.includes("knowledge:review") &&
    !access.permissionKeys.includes("knowledge:approve")
  ) {
    throw new Error("UNAUTHORIZED_REVIEW");
  }
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
  const hash = sha256Hex(input.text);
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
      org_id: input.orgId,
      name: input.title.slice(0, 200),
      source_type: input.originKind,
      origin_kind: input.originKind,
      raw_text: input.text,
      content_hash: hash,
      file_object_id: input.fileObjectId ?? null,
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
  return { sourceId: source.id, jobId: job.id, duplicate: false };
}

export async function processIngestionJob(
  client: Client,
  input: { jobId: string; access: AccessContext },
): Promise<{
  processed: number;
  total: number;
  failed: number;
  status: string;
}> {
  const { data: job, error } = await client
    .from("knowledge_ingestion_jobs")
    .select("*")
    .eq("id", input.jobId)
    .is("deleted_at", null)
    .single();
  if (error || !job) throw new Error(error?.message ?? "job not found");

  const { data: source } = await client
    .from("knowledge_sources")
    .select("*")
    .eq("id", job.source_id)
    .single();
  if (!source?.raw_text) {
    await client
      .from("knowledge_ingestion_jobs")
      .update({
        status: "failed",
        error_summary: "source_text_missing",
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    return { processed: 0, total: 0, failed: 1, status: "failed" };
  }

  const budget = DEFAULT_KNOWLEDGE_INGESTION_BUDGET;
  const drafts = splitKnowledgeBody(source.raw_text, {
    maxChars: budget.maxCharsPerSourceChunk,
    overlapChars: budget.overlapChars,
    minChars: budget.minChars,
  });

  if (job.total_units === 0) {
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

  const { data: pending } = await client
    .from("knowledge_source_chunks")
    .select("id, chunk_index, content, content_hash")
    .eq("source_id", source.id)
    .eq("status", "pending")
    .is("deleted_at", null)
    .order("chunk_index", { ascending: true })
    .limit(budget.maxUnitsPerTick);

  const extractor = new HeuristicKnowledgeExtractor();
  const guard = new KnowledgeIngestionBudgetGuard(budget);
  const meta = (source.metadata ?? {}) as {
    question?: string | null;
    answer?: string | null;
    domainKeys?: string[];
  };

  const { data: publishedDocs } = await client
    .from("knowledge_documents")
    .select("id, title, fact_status, is_current")
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
  }));

  let processed = 0;
  let failed = 0;
  const originKind = (source.origin_kind ?? "paste") as KnowledgeOriginKind;
  const qaOnce = originKind === "qa" && Boolean(meta.question && meta.answer);

  for (const unit of pending ?? []) {
    if (!guard.takeUnitTick(processed)) break;
    try {
      const draftsOut = await extractor.extract({
        originKind,
        title: source.name,
        text: unit.content,
        chunkIndex: unit.chunk_index,
        question: qaOnce ? meta.question : originKind === "qa" ? meta.question : null,
        answer: qaOnce ? meta.answer : originKind === "qa" ? meta.answer : null,
        domainKeys: meta.domainKeys,
      });
      const toInsert = qaOnce && unit.chunk_index > 0 ? [] : draftsOut;
      for (const cand of toInsert) {
        const conflict = classifyKnowledgeConflict({
          title: cand.title,
          body: cand.content,
          factStatus: cand.factStatus,
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
        await client.from("knowledge_candidates").insert({
          org_id: job.org_id,
          title: cand.title.slice(0, 200),
          content: cand.content.slice(0, 8_000),
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
          supersedes_document_id: conflict.existingId,
          confidence: cand.confidence,
          source_quality: cand.sourceQuality,
          extracted_at: new Date().toISOString(),
          status: "draft",
          contains_personal_conversation: source.contains_personal_conversation,
        });
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
      await client
        .from("knowledge_source_chunks")
        .update({
          status: "completed",
          extracted_at: new Date().toISOString(),
        })
        .eq("id", unit.id);
      processed += 1;
    } catch {
      failed += 1;
      await client
        .from("knowledge_source_chunks")
        .update({ status: "failed", error_code: "extract_failed" })
        .eq("id", unit.id);
    }
  }

  if (qaOnce && processed > 0) {
    await client
      .from("knowledge_source_chunks")
      .update({
        status: "completed",
        extracted_at: new Date().toISOString(),
      })
      .eq("source_id", source.id)
      .eq("status", "pending");
  }

  const { count: remaining } = await client
    .from("knowledge_source_chunks")
    .select("id", { count: "exact", head: true })
    .eq("source_id", source.id)
    .eq("status", "pending")
    .is("deleted_at", null);

  const total = drafts.length || job.total_units;
  const processedUnits = (job.processed_units ?? 0) + processed;
  const failedUnits = (job.failed_units ?? 0) + failed;
  const done = (remaining ?? 0) === 0;
  await client
    .from("knowledge_ingestion_jobs")
    .update({
      processed_units: processedUnits,
      failed_units: failedUnits,
      cursor_index: processedUnits,
      total_units: total,
      status: done ? (failedUnits > 0 && processedUnits === 0 ? "failed" : "completed") : "processing",
      completed_at: done ? new Date().toISOString() : null,
      error_summary: failed ? "unit_extract_failed" : null,
    })
    .eq("id", job.id);

  return {
    processed: processedUnits,
    total,
    failed: failedUnits,
    status: done ? "completed" : "processing",
  };
}

export async function processIngestionJobUntilIdle(
  client: Client,
  input: { jobId: string; access: AccessContext; maxTicks?: number },
) {
  let last = await processIngestionJob(client, input);
  const maxTicks = input.maxTicks ?? 20;
  let ticks = 1;
  while (last.status === "processing" && ticks < maxTicks) {
    last = await processIngestionJob(client, input);
    ticks += 1;
  }
  return last;
}

export async function listIngestionJobs(client: Client, orgId: string) {
  const { data, error } = await client
    .from("knowledge_ingestion_jobs")
    .select(
      "id, source_id, status, total_units, processed_units, failed_units, cursor_index, error_summary, started_at, completed_at, created_at",
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
  status?: KnowledgeReviewStatus,
) {
  let q = client
    .from("knowledge_candidates")
    .select(
      "id, title, summary, candidate_type, fact_status, review_status, conflict_kind, domain_keys, source_excerpt, source_quality, confidence, suggested_visibility, suggested_confidentiality_level, supersedes_document_id, created_at, source_id",
    )
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(100);
  if (status) q = q.eq("review_status", status);
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
): Promise<{ documentId?: string }> {
  requireReview(input.access);
  const { data: cand, error } = await client
    .from("knowledge_candidates")
    .select("*")
    .eq("id", input.candidateId)
    .single();
  if (error || !cand) throw new Error("candidate not found");

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
    if (cand.conflict_kind === "conflict" && input.action === "approve") {
      throw new Error("CONFLICT_REQUIRES_EXPLICIT_SUPERSEDE");
    }
  }

  await client.from("knowledge_candidate_reviews").insert({
    org_id: cand.org_id,
    candidate_id: cand.id,
    reviewer_id: input.access.userId,
    action: input.action,
    comment: input.comment ?? null,
  });

  if (input.action === "reject" || input.action === "mark_duplicate") {
    await client
      .from("knowledge_candidates")
      .update({
        review_status: input.action === "reject" ? "rejected" : "duplicate",
        status: "rejected",
      })
      .eq("id", cand.id);
    return {};
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
    sourceId = created.data?.id;
  }
  if (!sourceId) throw new Error("source required");

  const { data: doc, error: dErr } = await client
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

  await client.from("knowledge_document_versions").insert({
    document_id: doc.id,
    version_number: 1,
    body,
    created_by: input.access.userId,
  });

  for (const key of cand.domain_keys ?? ["company_common"]) {
    await client.from("knowledge_document_domains").insert({
      document_id: doc.id,
      domain_key: key,
      org_id: cand.org_id,
    });
  }

  if (input.action === "supersede" && cand.supersedes_document_id) {
    await client
      .from("knowledge_documents")
      .update({
        status: "superseded",
        is_current: false,
        fact_status: "historical",
        superseded_by_id: doc.id,
      })
      .eq("id", cand.supersedes_document_id);
  }

  await client
    .from("knowledge_documents")
    .update({ status: "published", published_at: new Date().toISOString() })
    .eq("id", doc.id);

  const ingest = await ingestPublishedDocumentChunks(client, {
    documentId: doc.id,
    embedding: createEmbeddingProvider(),
  });
  const embedding = createEmbeddingProvider();
  let embeddingStatus: "ready" | "failed" | "skipped" = "skipped";
  if (embedding.available) {
    embeddingStatus = ingest.embedded ? "ready" : "failed";
  }
  if (embeddingStatus === "failed") {
    await client
      .from("knowledge_documents")
      .update({ status: "approved", published_at: null, embedding_status: "failed" })
      .eq("id", doc.id);
    throw new Error("EMBEDDING_FAILED");
  }
  await client
    .from("knowledge_documents")
    .update({ embedding_status: embeddingStatus })
    .eq("id", doc.id);

  await client
    .from("knowledge_candidates")
    .update({
      review_status: "approved",
      status: "approved",
      published_document_id: doc.id,
      confirmed_visibility: targetVis,
    })
    .eq("id", cand.id);

  return { documentId: doc.id };
}

export async function batchReviewCandidates(
  client: Client,
  input: {
    access: AccessContext;
    candidateIds: string[];
    action: "approve" | "reject";
  },
): Promise<{ ok: string[]; skipped: string[] }> {
  requireReview(input.access);
  const ok: string[] = [];
  const skipped: string[] = [];
  for (const id of input.candidateIds) {
    const { data: cand } = await client
      .from("knowledge_candidates")
      .select("id, review_status, conflict_kind")
      .eq("id", id)
      .maybeSingle();
    if (!cand) {
      skipped.push(id);
      continue;
    }
    if (
      input.action === "approve" &&
      !canBatchApprove({
        reviewStatus: cand.review_status,
        conflictKind: cand.conflict_kind,
      })
    ) {
      skipped.push(id);
      continue;
    }
    try {
      await reviewCandidate(client, {
        access: input.access,
        candidateId: id,
        action: input.action === "approve" ? "approve" : "reject",
      });
      ok.push(id);
    } catch {
      skipped.push(id);
    }
  }
  return { ok, skipped };
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
