import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/types";
import type { ArtifactPersistence, FileObjectPersistence, PersistedTask, ResearchPersistence, TaskPersistence } from "./ports";
import type { StoredArtifact } from "@/lib/application/artifact-service";
import type { ResearchRun, ResearchStatus } from "@/lib/application/research-service";
import type { FileObjectMeta } from "@/lib/application/file-object-service";
import { levelFromDb, levelToDb } from "./level-map";
import { parseVisibility } from "./mappers";
import {
  buildOrgThreadFilePath,
  compensateFailedUpload,
  downloadObject,
  sha256Hex,
  uploadObject,
  type StorageBucket,
} from "./storage-objects";

type Client = SupabaseClient<Database>;

const researchIdempotency = new Map<string, string>();

type ResearchRunRow = Database["public"]["Tables"]["research_runs"]["Row"];

function extrasToJson(run: ResearchRun): Json {
  return {
    queries: run.queries,
    queryPlan: (run.queryPlan ?? null) as Json,
    sources: run.sources as Json,
    findings: run.findings,
    citations: run.citations as Json,
    resultArtifactId: run.resultArtifactId,
    processingMetadata: run.processingMetadata,
    title: run.title,
    errorCode: run.errorCode,
    errorMessage: run.errorMessage,
    demoNoticeShown: run.demoNoticeShown,
  };
}

function extrasFromJson(value: Json | null | undefined): Partial<ResearchRun> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const o = value as Record<string, Json | undefined>;
  const queries = Array.isArray(o.queries)
    ? o.queries.filter((q): q is string => typeof q === "string")
    : undefined;
  const findings = Array.isArray(o.findings)
    ? o.findings.filter((f): f is string => typeof f === "string")
    : undefined;
  const processingMetadata =
    o.processingMetadata &&
    typeof o.processingMetadata === "object" &&
    !Array.isArray(o.processingMetadata)
      ? Object.fromEntries(
          Object.entries(o.processingMetadata).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : undefined;
  return {
    queries,
    queryPlan: (o.queryPlan as ResearchRun["queryPlan"]) ?? undefined,
    sources: (o.sources as ResearchRun["sources"]) ?? undefined,
    findings,
    citations: (o.citations as ResearchRun["citations"]) ?? undefined,
    resultArtifactId:
      typeof o.resultArtifactId === "string" || o.resultArtifactId === null
        ? o.resultArtifactId
        : undefined,
    processingMetadata,
    title: typeof o.title === "string" ? o.title : undefined,
    errorCode: typeof o.errorCode === "string" || o.errorCode === null ? o.errorCode : undefined,
    errorMessage:
      typeof o.errorMessage === "string" || o.errorMessage === null
        ? o.errorMessage
        : undefined,
    demoNoticeShown: typeof o.demoNoticeShown === "boolean" ? o.demoNoticeShown : undefined,
  };
}

function providerFromRow(value: string | null | undefined): ResearchRun["provider"] {
  if (
    value === "demo" ||
    value === "searxng" ||
    value === "http" ||
    value === "web-intelligence"
  ) {
    return value;
  }
  return "http";
}

function mapResearchStatusToDb(
  status: ResearchStatus,
): "pending" | "running" | "completed" | "failed" | "cancelled" {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "draft":
    case "queued":
      return "pending";
    default:
      return "running";
  }
}

function mapResearchStatusFromDb(
  status: string,
): ResearchStatus {
  if (status === "pending") return "queued";
  if (status === "running") return "searching";
  if (status === "completed" || status === "failed" || status === "cancelled") {
    return status;
  }
  return "queued";
}

function researchFromRow(
  row: ResearchRunRow,
  extras?: Partial<ResearchRun>,
): ResearchRun {
  const stored = extrasFromJson(row.extras);
  const merged: Partial<ResearchRun> = { ...stored, ...extras };
  return {
    id: row.id,
    threadId: row.origin_thread_id ?? "",
    requestMessageId: row.origin_message_id,
    organizationId: row.org_id,
    requestedBy: row.created_by,
    confidentialityLevel: levelFromDb(row.confidentiality_level),
    visibility: parseVisibility(row.visibility),
    projectId: row.project_id,
    status: mapResearchStatusFromDb(row.status),
    purpose: row.query,
    queries: merged.queries ?? [row.query],
    queryPlan: merged.queryPlan ?? null,
    sources: merged.sources ?? [],
    findings: merged.findings ?? [],
    citations: merged.citations ?? [],
    resultArtifactId: merged.resultArtifactId ?? null,
    startedAt: row.created_at,
    completedAt: row.status === "completed" ? row.updated_at : null,
    failedAt: row.status === "failed" ? row.updated_at : null,
    provider: merged.provider ?? providerFromRow(row.provider),
    isDemo: merged.isDemo ?? row.is_demo ?? false,
    errorCode: merged.errorCode ?? null,
    errorMessage: merged.errorMessage ?? null,
    processingMetadata: merged.processingMetadata ?? { mode: "supabase" },
    title: merged.title ?? row.query.slice(0, 40),
    demoNoticeShown: merged.demoNoticeShown ?? false,
  };
}

export function createSupabaseTaskPersistence(client: Client): TaskPersistence {
  return {
    async create(task) {
      const { data, error } = await client
        .from("tasks")
        .insert({
          id: task.id,
          org_id: task.orgId,
          project_id: task.projectId,
          title: task.title,
          description: task.description,
          status: task.status,
          created_by: task.createdBy,
          confidentiality_level: levelToDb(task.confidentialityLevel),
          visibility: task.visibility,
          origin_thread_id: task.originThreadId,
          origin_message_id: task.originMessageId,
          security_label_source: "inherited",
          minimum_derived_level: levelToDb(task.confidentialityLevel),
          created_at: task.createdAt,
          updated_at: task.updatedAt,
        })
        .select("*")
        .single();
      if (error || !data) {
        throw new Error(`tasks insert failed: ${error?.message}`);
      }
      return {
        ...task,
        id: data.id,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
    },

    async get(id) {
      const { data, error } = await client
        .from("tasks")
        .select("*")
        .eq("id", id)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return {
        id: data.id,
        orgId: data.org_id,
        title: data.title,
        description: data.description,
        status: data.status,
        projectId: data.project_id,
        createdBy: data.created_by,
        confidentialityLevel: levelFromDb(data.confidentiality_level),
        visibility: parseVisibility(data.visibility),
        originThreadId: data.origin_thread_id,
        originMessageId: data.origin_message_id,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      } satisfies PersistedTask;
    },

    async listByThread(threadId) {
      const { data, error } = await client
        .from("tasks")
        .select("*")
        .eq("origin_thread_id", threadId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []).map((data) => ({
        id: data.id,
        orgId: data.org_id,
        title: data.title,
        description: data.description,
        status: data.status,
        projectId: data.project_id,
        createdBy: data.created_by,
        confidentialityLevel: levelFromDb(data.confidentiality_level),
        visibility: parseVisibility(data.visibility),
        originThreadId: data.origin_thread_id,
        originMessageId: data.origin_message_id,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      }));
    },

    async listAccessible() {
      const { data, error } = await client
        .from("tasks")
        .select("*")
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return (data ?? []).map((data) => ({
        id: data.id,
        orgId: data.org_id,
        title: data.title,
        description: data.description,
        status: data.status,
        projectId: data.project_id,
        createdBy: data.created_by,
        confidentialityLevel: levelFromDb(data.confidentiality_level),
        visibility: parseVisibility(data.visibility),
        originThreadId: data.origin_thread_id,
        originMessageId: data.origin_message_id,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      }));
    },

    async update(id, patch) {
      const updates: {
        updated_at: string;
        title?: string;
        description?: string | null;
        status?: string;
      } = {
        updated_at: new Date().toISOString(),
      };
      if (patch.title !== undefined) updates.title = patch.title;
      if (patch.description !== undefined) {
        updates.description = patch.description ?? "";
      }
      if (patch.status !== undefined) updates.status = patch.status;
      const { data, error } = await client
        .from("tasks")
        .update(updates)
        .eq("id", id)
        .select("*")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return {
        id: data.id,
        orgId: data.org_id,
        title: data.title,
        description: data.description,
        status: data.status,
        projectId: data.project_id,
        createdBy: data.created_by,
        confidentialityLevel: levelFromDb(data.confidentiality_level),
        visibility: parseVisibility(data.visibility),
        originThreadId: data.origin_thread_id,
        originMessageId: data.origin_message_id,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
    },
  };
}

/** Maps artifact row + version rows (canonical_content is durable source of truth). */
function artifactFromRows(
  data: {
    id: string;
    title: string;
    format: string;
    project_id: string | null;
    origin_thread_id: string | null;
    origin_message_id: string | null;
    confidentiality_level: number;
    visibility: string;
    created_at: string;
    updated_at: string;
  },
  versions: {
    version_number: number;
    canonical_content: string | null;
    storage_path: string | null;
    created_at: string;
  }[],
): StoredArtifact {
  const mapped = versions.map((v) => ({
    version: v.version_number,
    markdownPreview: v.canonical_content ?? "",
    createdAt: v.created_at,
    storagePath: v.storage_path,
  }));
  const latest = mapped.at(-1);
  const format = data.format as StoredArtifact["format"];
  const ready = format === "markdown";
  return {
    id: data.id,
    threadId: data.origin_thread_id ?? "",
    messageId: data.origin_message_id,
    title: data.title,
    format,
    formatStatus: ready ? "ready" : "disabled",
    disabledReason: ready
      ? null
      : `${format.toUpperCase()}生成は未接続です（本文はMarkdownとして保存）`,
    markdownPreview: latest?.markdownPreview ?? "",
    version: latest?.version ?? 1,
    versions: mapped.map(({ version, markdownPreview, createdAt }) => ({
      version,
      markdownPreview,
      createdAt,
    })),
    confidentialityLevel: levelFromDb(data.confidentiality_level),
    visibility: parseVisibility(data.visibility),
    projectId: data.project_id,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    subtype: "document",
  };
}

export function createSupabaseArtifactPersistence(
  client: Client,
): ArtifactPersistence {
  return {
    async create(artifact, orgId, createdBy) {
      const { data, error } = await client
        .from("artifacts")
        .insert({
          id: artifact.id,
          org_id: orgId,
          project_id: artifact.projectId,
          title: artifact.title,
          format: artifact.format === "markdown" ? "markdown" : artifact.format,
          created_by: createdBy,
          confidentiality_level: levelToDb(artifact.confidentialityLevel),
          visibility: artifact.visibility,
          origin_thread_id: artifact.threadId,
          origin_message_id: artifact.messageId,
          security_label_source: "inherited",
          minimum_derived_level: levelToDb(artifact.confidentialityLevel),
          created_at: artifact.createdAt,
          updated_at: artifact.updatedAt,
        })
        .select("*")
        .single();
      if (error || !data) {
        throw new Error(`artifacts insert failed: ${error?.message}`);
      }

      const content = artifact.markdownPreview;
      const checksum = await sha256Hex(new TextEncoder().encode(content));
      const { error: verErr } = await client.from("artifact_versions").insert({
        artifact_id: artifact.id,
        version_number: artifact.version,
        storage_path: null,
        checksum,
        created_at: artifact.createdAt,
        canonical_content: content,
      });
      if (verErr) {
        throw new Error(`artifact_versions insert failed: ${verErr.message}`);
      }

      return artifact;
    },

    async update(artifact) {
      const { error } = await client
        .from("artifacts")
        .update({
          title: artifact.title,
          updated_at: artifact.updatedAt,
          confidentiality_level: levelToDb(artifact.confidentialityLevel),
          visibility: artifact.visibility,
        })
        .eq("id", artifact.id);
      if (error) throw new Error(error.message);

      const latest = artifact.versions[artifact.versions.length - 1];
      if (latest) {
        const checksum = await sha256Hex(
          new TextEncoder().encode(latest.markdownPreview),
        );
        const { error: verErr } = await client.from("artifact_versions").insert({
          artifact_id: artifact.id,
          version_number: latest.version,
          storage_path: null,
          checksum,
          created_at: latest.createdAt,
          canonical_content: latest.markdownPreview,
        });
        if (verErr) {
          // Idempotent revise retries: unique (artifact_id, version_number)
          if (!/duplicate|unique/i.test(verErr.message)) {
            throw new Error(`artifact_versions insert failed: ${verErr.message}`);
          }
        }
      }
      return artifact;
    },

    async get(id) {
      const { data, error } = await client
        .from("artifacts")
        .select("*")
        .eq("id", id)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;

      const { data: versions, error: verErr } = await client
        .from("artifact_versions")
        .select("*")
        .eq("artifact_id", id)
        .is("deleted_at", null)
        .order("version_number", { ascending: true });
      if (verErr) throw new Error(verErr.message);

      return artifactFromRows(
        data,
        (versions ?? []).map((v) => ({
          version_number: v.version_number,
          canonical_content: v.canonical_content,
          storage_path: v.storage_path,
          created_at: v.created_at,
        })),
      );
    },

    async listByThread(threadId) {
      const { data, error } = await client
        .from("artifacts")
        .select("*")
        .eq("origin_thread_id", threadId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      const out: StoredArtifact[] = [];
      for (const row of data ?? []) {
        const item = await this.get(row.id);
        if (item) out.push(item);
      }
      return out;
    },

    async listLibrary() {
      const { data, error } = await client
        .from("artifacts")
        .select("*")
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      const out: StoredArtifact[] = [];
      for (const row of data ?? []) {
        const item = await this.get(row.id);
        if (item) out.push(item);
      }
      return out;
    },
  };
}

export function createSupabaseResearchPersistence(
  client: Client,
): ResearchPersistence {
  return {
    async create(run) {
      const { data, error } = await client
        .from("research_runs")
        .insert({
          id: run.id,
          org_id: run.organizationId,
          project_id: run.projectId,
          query: run.purpose,
          status: mapResearchStatusToDb(run.status),
          created_by: run.requestedBy,
          confidentiality_level: levelToDb(run.confidentialityLevel),
          visibility: run.visibility,
          origin_thread_id: run.threadId,
          origin_message_id: run.requestMessageId,
          security_label_source: "inherited",
          created_at: run.startedAt,
          updated_at: run.completedAt ?? run.startedAt,
          provider: run.provider,
          is_demo: run.isDemo,
          extras: extrasToJson(run),
        })
        .select("*")
        .single();
      if (error || !data) {
        throw new Error(`research_runs insert failed: ${error?.message}`);
      }
      return researchFromRow(data, run);
    },

    async update(run) {
      const { data, error } = await client
        .from("research_runs")
        .update({
          status: mapResearchStatusToDb(run.status),
          query: run.purpose,
          updated_at: new Date().toISOString(),
          confidentiality_level: levelToDb(run.confidentialityLevel),
          visibility: run.visibility,
          provider: run.provider,
          is_demo: run.isDemo,
          extras: extrasToJson(run),
        })
        .eq("id", run.id)
        .select("*")
        .single();
      if (error || !data) {
        throw new Error(`research_runs update failed: ${error?.message}`);
      }
      return researchFromRow(data, run);
    },

    async get(id) {
      const { data, error } = await client
        .from("research_runs")
        .select("*")
        .eq("id", id)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? researchFromRow(data) : null;
    },

    async listByThread(threadId) {
      const { data, error } = await client
        .from("research_runs")
        .select("*")
        .eq("origin_thread_id", threadId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => researchFromRow(row));
    },

    async listLibrary() {
      const { data, error } = await client
        .from("research_runs")
        .select("*")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => researchFromRow(row));
    },

    async findByIdempotencyKey(key) {
      const id = researchIdempotency.get(key);
      if (!id) return null;
      return this.get(id);
    },

    async saveIdempotency(key, runId) {
      researchIdempotency.set(key, runId);
    },
  };
}

export function createSupabaseFilePersistence(
  client: Client,
): FileObjectPersistence {
  function mapFileRow(data: {
    id: string;
    bucket: string;
    path: string;
    mime_type: string | null;
    size_bytes: number | null;
    checksum: string | null;
    origin_thread_id: string | null;
    origin_message_id: string | null;
    confidentiality_level: number;
    visibility: string;
    created_at: string;
    original_filename?: string | null;
  }): FileObjectMeta {
    const original =
      data.original_filename ??
      data.path.split("/").pop() ??
      data.path;
    return {
      id: data.id,
      threadId: data.origin_thread_id ?? "",
      messageId: data.origin_message_id,
      name: original,
      originalFilename: original,
      mimeType: data.mime_type ?? "application/octet-stream",
      sizeBytes: Number(data.size_bytes ?? 0),
      confidentialityLevel: levelFromDb(data.confidentiality_level),
      visibility: parseVisibility(data.visibility),
      storageMode: "supabase",
      createdAt: data.created_at,
      bucket: data.bucket,
      path: data.path,
      checksum: data.checksum,
      durable: true,
      ephemeralNotice: null,
    };
  }

  return {
    async create(file, meta) {
      if (!meta.content || meta.content.byteLength === 0) {
        throw new Error("FILE_CONTENT_REQUIRED");
      }
      const checkSize = meta.content.byteLength;
      if (checkSize !== file.sizeBytes && file.sizeBytes > 0) {
        // Prefer measured bytes from content
        file = { ...file, sizeBytes: checkSize };
      }

      const bucket = (meta.bucket ?? "chat-attachments") as StorageBucket;
      const path =
        meta.path ??
        buildOrgThreadFilePath({
          orgId: meta.orgId,
          threadId: file.threadId,
          fileId: file.id,
          filename: file.name,
        });
      const checksum = await sha256Hex(meta.content);

      // Idempotent: same id already durable → return existing
      const existing = await this.get(file.id);
      if (existing?.durable && existing.path === path) {
        return existing;
      }

      // 1) Metadata first (Storage SELECT requires readable file_objects)
      const { error: metaErr } = await client.from("file_objects").insert({
        id: file.id,
        org_id: meta.orgId,
        bucket,
        path,
        mime_type: file.mimeType,
        size_bytes: file.sizeBytes,
        checksum,
        created_by: meta.createdBy,
        confidentiality_level: levelToDb(file.confidentialityLevel),
        visibility: file.visibility,
        origin_thread_id: file.threadId,
        origin_message_id: file.messageId,
        created_at: file.createdAt,
        original_filename: file.name,
      });

      if (metaErr) {
        throw new Error(`file_objects insert failed: ${metaErr.message}`);
      }

      // 2) Storage upload (authenticated JWT)
      const uploaded = await uploadObject({
        client: client as never,
        bucket,
        path,
        bytes: meta.content,
        contentType: file.mimeType,
        upsert: false,
      });

      if (!uploaded.ok) {
        await compensateFailedUpload({
          client: client as never,
          fileId: file.id,
          bucket,
          path,
          phase: "after_metadata",
        });
        throw new Error(`storage upload failed: ${uploaded.message}`);
      }

      return mapFileRow({
        id: file.id,
        bucket,
        path,
        mime_type: file.mimeType,
        size_bytes: file.sizeBytes,
        checksum,
        origin_thread_id: file.threadId,
        origin_message_id: file.messageId,
        confidentiality_level: levelToDb(file.confidentialityLevel),
        visibility: file.visibility,
        created_at: file.createdAt,
        original_filename: file.name,
      });
    },

    async get(id) {
      const { data, error } = await client
        .from("file_objects")
        .select("*")
        .eq("id", id)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return mapFileRow(data);
    },

    async listByThread(threadId) {
      const { data, error } = await client
        .from("file_objects")
        .select("*")
        .eq("origin_thread_id", threadId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => mapFileRow(row));
    },

    async download(id) {
      const meta = await this.get(id);
      if (!meta?.bucket || !meta.path) return null;
      const dl = await downloadObject({
        client: client as never,
        bucket: meta.bucket as StorageBucket,
        path: meta.path,
      });
      if (!dl.ok) return null;
      return { meta, bytes: dl.bytes };
    },
  };
}
