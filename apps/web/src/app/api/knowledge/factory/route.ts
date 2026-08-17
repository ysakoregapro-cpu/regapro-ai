import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { resolveAppSession } from "@/lib/application/session-access";
import { isDevSampleMode } from "@/lib/supabase/env";
import { ConfidentialityLevelSchema, VisibilitySchema } from "@regapro/shared";
import {
  GenericTranscriptIngestPort,
  KnowledgeDomainKeySchema,
  KnowledgeOriginKind,
  KnowledgeReviewStatus,
  transcriptToReusableText,
} from "@regapro/knowledge";
import {
  batchReviewCandidates,
  cancelIngestionJob,
  createKnowledgeSourceAndJob,
  createStructuredKnowledgeItem,
  factoryCounts,
  ingestFileSource,
  ingestUrlSource,
  listIngestionJobs,
  listReviewInbox,
  pauseIngestionJob,
  previewExtractedSource,
  previewSourceDelete,
  processIngestionJob,
  processIngestionJobUntilIdle,
  resumeIngestionJob,
  retryDocumentEmbedding,
  retryFailedIngestionChunks,
  reviewCandidate,
} from "@/lib/application/knowledge-factory-service";

export const runtime = "nodejs";

const IngestSchema = z.object({
  action: z.literal("ingest").optional(),
  originKind: KnowledgeOriginKind.default("paste"),
  title: z.string().min(1).max(200),
  text: z.string().max(2_000_000).optional().default(""),
  question: z.string().max(4000).optional(),
  answer: z.string().max(20_000).optional(),
  url: z.string().url().optional(),
  domainKeys: z.array(KnowledgeDomainKeySchema).optional(),
  sourceDate: z.string().optional(),
  confidentialityLevel: ConfidentialityLevelSchema.default("company"),
  visibility: VisibilitySchema.default("organization"),
  expertName: z.string().max(120).optional(),
  transcript: z.unknown().optional(),
  importMode: z.enum(["structured", "source", "qa"]).optional(),
  importItemId: z.string().min(1).max(120).optional(),
  candidateType: z.string().optional(),
  factStatus: z.string().optional(),
  isCurrent: z.boolean().optional(),
  sourceQuality: z.number().min(0).max(1).optional(),
  tags: z.array(z.string()).optional(),
});

const ProcessSchema = z.object({
  action: z.literal("process"),
  jobId: z.string().uuid(),
});

const JobControlSchema = z.object({
  action: z.enum(["pause", "resume", "retry_failed", "cancel"]),
  jobId: z.string().uuid(),
});

const ReviewSchema = z.object({
  action: z.literal("review"),
  candidateId: z.string().uuid(),
  reviewAction: z.enum([
    "approve",
    "edit_approve",
    "reject",
    "merge",
    "mark_duplicate",
    "supersede",
  ]),
  title: z.string().max(200).optional(),
  content: z.string().max(20_000).optional(),
  visibility: VisibilitySchema.optional(),
  comment: z.string().max(500).optional(),
});

const BatchSchema = z.object({
  action: z.literal("batch_review"),
  candidateIds: z.array(z.string().uuid()).min(1).max(40),
  reviewAction: z.enum(["approve", "reject"]),
});

const RetrySchema = z.object({
  action: z.literal("retry_embed"),
  documentId: z.string().uuid(),
});

function sampleBlocked() {
  return NextResponse.json(
    { error: "Knowledge Factory は supabase モードで利用できます。" },
    { status: 400 },
  );
}

export async function GET(req: Request) {
  if (isDevSampleMode()) {
    return NextResponse.json({
      mode: "dev-sample",
      inbox: [],
      jobs: [],
      counts: {},
    });
  }
  const session = await resolveAppSession({});
  const client = await createServerSupabaseClient();
  const url = new URL(req.url);
  const view = url.searchParams.get("view") ?? "inbox";
  const status = url.searchParams.get("status");
  if (view === "counts") {
    return NextResponse.json({
      counts: await factoryCounts(client, session.access.organizationId),
    });
  }
  if (view === "jobs") {
    return NextResponse.json({
      jobs: await listIngestionJobs(client, session.access.organizationId),
    });
  }
  const inbox = await listReviewInbox(client, session.access.organizationId, {
    status:
      status && KnowledgeReviewStatus.safeParse(status).success
        ? (status as z.infer<typeof KnowledgeReviewStatus>)
        : undefined,
    domain: url.searchParams.get("domain") ?? undefined,
    sourceId: url.searchParams.get("sourceId") ?? undefined,
    conflict: url.searchParams.get("conflict") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
    current:
      url.searchParams.get("current") === "true"
        ? true
        : url.searchParams.get("current") === "false"
          ? false
          : undefined,
  });
  return NextResponse.json({ inbox });
}

export async function POST(req: Request) {
  if (isDevSampleMode()) return sampleBlocked();
  const session = await resolveAppSession({});
  const client = await createServerSupabaseClient();
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0) {
      return NextResponse.json({ error: "ファイルがありません" }, { status: 400 });
    }
    const preview = form.get("preview") === "1" || form.get("preview") === "true";
    if (preview) {
      const previews = [];
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        previews.push(
          previewExtractedSource({
            filename: file.name,
            mimeType: file.type || "application/octet-stream",
            bytes,
          }),
        );
      }
      return NextResponse.json({ ok: true, previews });
    }
    const domainRaw = String(form.get("domainKeys") ?? "company_common");
    const domainKeys = domainRaw
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);
    const parsedDomains = z.array(KnowledgeDomainKeySchema).safeParse(domainKeys);
    if (!parsedDomains.success) {
      return NextResponse.json({ error: "不明な領域です" }, { status: 400 });
    }
    const confidentialityLevel = ConfidentialityLevelSchema.catch("company").parse(
      form.get("confidentialityLevel") || "company",
    );
    const visibility = VisibilitySchema.catch("organization").parse(
      form.get("visibility") || "organization",
    );
    const originKind = KnowledgeOriginKind.catch("file").parse(
      form.get("originKind") || "file",
    );
    const importModeRaw = String(form.get("importMode") || "");
    const importMode =
      importModeRaw === "structured" || importModeRaw === "source" || importModeRaw === "qa"
        ? importModeRaw
        : originKind === "authoritative_seed"
          ? "structured"
          : undefined;
    const title = String(form.get("title") || "").trim();
    const results: Array<{
      name: string;
      ok: boolean;
      sourceId?: string;
      jobId?: string;
      error?: string;
    }> = [];
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await ingestFileSource(client, {
        access: session.access,
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        bytes,
        originKind,
        domainKeys: parsedDomains.data,
        confidentialityLevel,
        visibility,
        title: title || undefined,
        importMode,
      });
      results.push(result);
    }
    return NextResponse.json({ ok: true, results });
  }

  const json = await req.json();
  const action = typeof json?.action === "string" ? json.action : "ingest";

  try {
    if (action === "process") {
      const parsed = ProcessSchema.safeParse({ ...json, action });
      if (!parsed.success) {
        return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
      }
      const progress = await processIngestionJobUntilIdle(client, {
        jobId: parsed.data.jobId,
        access: session.access,
        maxTicks: 4,
      });
      return NextResponse.json({ ok: true, progress });
    }

    if (action === "pause" || action === "resume" || action === "retry_failed" || action === "cancel") {
      const parsed = JobControlSchema.safeParse({ ...json, action });
      if (!parsed.success) {
        return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
      }
      if (parsed.data.action === "pause") {
        await pauseIngestionJob(client, parsed.data.jobId);
        return NextResponse.json({ ok: true });
      }
      if (parsed.data.action === "resume") {
        const progress = await resumeIngestionJob(client, {
          jobId: parsed.data.jobId,
          access: session.access,
        });
        return NextResponse.json({ ok: true, progress });
      }
      if (parsed.data.action === "retry_failed") {
        const progress = await retryFailedIngestionChunks(client, {
          jobId: parsed.data.jobId,
          access: session.access,
        });
        return NextResponse.json({ ok: true, progress });
      }
      await cancelIngestionJob(client, parsed.data.jobId);
      return NextResponse.json({ ok: true });
    }

    if (action === "preview_source_delete") {
      const sourceId = z.string().uuid().safeParse(json.sourceId);
      if (!sourceId.success) {
        return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
      }
      const plan = await previewSourceDelete(client, sourceId.data);
      return NextResponse.json({ ok: true, plan });
    }

    if (action === "review") {
      const parsed = ReviewSchema.safeParse({ ...json, action });
      if (!parsed.success) {
        return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
      }
      const result = await reviewCandidate(client, {
        access: session.access,
        candidateId: parsed.data.candidateId,
        action: parsed.data.reviewAction,
        title: parsed.data.title,
        content: parsed.data.content,
        visibility: parsed.data.visibility,
        comment: parsed.data.comment,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === "batch_review") {
      const parsed = BatchSchema.safeParse({ ...json, action });
      if (!parsed.success) {
        return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
      }
      const result = await batchReviewCandidates(client, {
        access: session.access,
        candidateIds: parsed.data.candidateIds,
        action: parsed.data.reviewAction,
      });
      return NextResponse.json({
        ok: true,
        approvedIds: result.ok,
        skipped: result.skipped,
      });
    }

    if (action === "retry_embed") {
      const parsed = RetrySchema.safeParse({ ...json, action });
      if (!parsed.success) {
        return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
      }
      const result = await retryDocumentEmbedding(client, parsed.data.documentId);
      return NextResponse.json({ ok: true, ...result });
    }

    const parsed = IngestSchema.safeParse({ ...json, action: "ingest" });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    const data = parsed.data;
    let text = data.text;
    if (data.originKind === "qa") {
      if (!data.question || !data.answer) {
        return NextResponse.json({ error: "Q&A には質問と回答が必要です" }, { status: 400 });
      }
      text = `Q: ${data.question}\n\nA: ${data.answer}${
        data.expertName ? `\n\n専門家: ${data.expertName}` : ""
      }`;
    }
    if (data.originKind === "transcript" && data.transcript) {
      const port = new GenericTranscriptIngestPort();
      text = transcriptToReusableText(port.parse(data.transcript));
    }
    if (!text.trim() && data.originKind !== "url") {
      return NextResponse.json({ error: "取り込む本文がありません" }, { status: 400 });
    }
    if (data.originKind === "url" && data.url) {
      const created = await ingestUrlSource(client, {
        orgId: session.access.organizationId,
        userId: session.access.userId,
        access: session.access,
        originKind: "url",
        title: data.title,
        text,
        url: data.url,
        confidentialityLevel: data.confidentialityLevel,
        visibility: data.visibility,
        domainKeys: data.domainKeys,
        sourceDate: data.sourceDate ?? null,
      });
      if (!created.duplicate && !created.limitation) {
        await processIngestionJob(client, {
          jobId: created.jobId,
          access: session.access,
        });
      }
      return NextResponse.json({ ok: true, ...created });
    }

    const createdInput = {
      orgId: session.access.organizationId,
      userId: session.access.userId,
      access: session.access,
      originKind: data.originKind,
      title: data.title,
      text,
      question: data.question,
      answer: data.answer,
      url: data.url,
      confidentialityLevel: data.confidentialityLevel,
      visibility: data.visibility,
      domainKeys: data.domainKeys,
      sourceDate: data.sourceDate ?? null,
      importMode: data.importMode,
      importItemId: data.importItemId,
      isCurrent: data.isCurrent,
      sourceQuality: data.sourceQuality,
      tags: data.tags,
      expertName: data.expertName,
    };
    const useStructured =
      data.importMode === "structured" ||
      data.importMode === "qa" ||
      data.originKind === "authoritative_seed" ||
      data.originKind === "qa";
    if (useStructured) {
      const created = await createStructuredKnowledgeItem(client, {
        ...createdInput,
        importMode: data.importMode === "qa" ? "qa" : "structured",
      });
      return NextResponse.json({ ok: true, ...created });
    }
    const created = await createKnowledgeSourceAndJob(client, createdInput);
    if (!created.duplicate) {
      await processIngestionJob(client, {
        jobId: created.jobId,
        access: session.access,
      });
    }
    return NextResponse.json({ ok: true, ...created });
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed";
    const status =
      message.startsWith("UNAUTHORIZED") || message.includes("PRIVATE_SOURCE")
        ? 403
        : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
