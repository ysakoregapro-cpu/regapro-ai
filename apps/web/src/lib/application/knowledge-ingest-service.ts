import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  canTransitionKnowledge,
  planChunkUpserts,
  sha256Hex,
  splitKnowledgeBody,
  transitionKnowledge,
  type EmbeddingProvider,
  type KnowledgeLifecycleState,
} from "@regapro/knowledge";
import { createEmbeddingProvider } from "@regapro/local-ai";
import {
  confidentialityRank,
  type ConfidentialityLevel,
  type Visibility,
} from "@regapro/shared";
import type { Database } from "@/lib/supabase/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<Database, "public", any>;

export type ManualKnowledgeInput = {
  orgId: string;
  userId: string;
  title: string;
  body: string;
  confidentialityLevel: ConfidentialityLevel;
  visibility: Visibility;
  departmentId?: string | null;
  projectId?: string | null;
};

async function ensureManualSource(
  client: Client,
  orgId: string,
): Promise<string> {
  const { data: existing } = await client
    .from("knowledge_sources")
    .select("id")
    .eq("org_id", orgId)
    .eq("source_type", "manual")
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  if (existing?.id) return existing.id;

  const { data, error } = await client
    .from("knowledge_sources")
    .insert({
      org_id: orgId,
      name: "手動入力",
      source_type: "manual",
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "knowledge_sources insert failed");
  }
  return data.id;
}

export async function createManualKnowledgeDraft(
  client: Client,
  input: ManualKnowledgeInput,
): Promise<{ documentId: string; versionId: string }> {
  const sourceId = await ensureManualSource(client, input.orgId);
  const contentHash = sha256Hex(input.body);
  const { data: doc, error: dErr } = await client
    .from("knowledge_documents")
    .insert({
      org_id: input.orgId,
      source_id: sourceId,
      title: input.title,
      status: "draft",
      content_hash: contentHash,
      confidentiality_level: confidentialityRank(input.confidentialityLevel),
      visibility: input.visibility,
      owner_user_id: input.userId,
      department_id: input.departmentId ?? null,
      project_id: input.projectId ?? null,
      source_type: "manual",
      contains_personal_conversation: false,
    })
    .select("id")
    .single();
  if (dErr || !doc) {
    throw new Error(dErr?.message ?? "knowledge_documents insert failed");
  }

  const { data: ver, error: vErr } = await client
    .from("knowledge_document_versions")
    .insert({
      document_id: doc.id,
      version_number: 1,
      body: input.body,
      created_by: input.userId,
    })
    .select("id")
    .single();
  if (vErr || !ver) {
    throw new Error(vErr?.message ?? "knowledge_document_versions insert failed");
  }
  return { documentId: doc.id, versionId: ver.id };
}

export async function transitionManualKnowledge(
  client: Client,
  input: {
    documentId: string;
    from: KnowledgeLifecycleState;
    to: KnowledgeLifecycleState;
    userId: string;
    reason?: string;
  },
): Promise<void> {
  if (!canTransitionKnowledge(input.from, input.to)) {
    throw new Error(`Invalid transition ${input.from} -> ${input.to}`);
  }
  transitionKnowledge(input.from, input.to);

  const patch: {
    status: string;
    updated_at: string;
    published_at?: string;
  } = {
    status: input.to,
    updated_at: new Date().toISOString(),
  };
  if (input.to === "published") {
    patch.published_at = new Date().toISOString();
  }

  const { error } = await client
    .from("knowledge_documents")
    .update(patch)
    .eq("id", input.documentId);
  if (error) throw new Error(error.message);

  await client.from("knowledge_revisions").insert({
    document_id: input.documentId,
    from_status: input.from,
    to_status: input.to,
    changed_by: input.userId,
    reason: input.reason ?? null,
  });

  if (input.to === "approved") {
    await client.from("knowledge_approvals").insert({
      document_id: input.documentId,
      approver_id: input.userId,
      decision: "approved",
      comment: input.reason ?? null,
    });
  }

  if (input.to === "published") {
    await ingestPublishedDocumentChunks(client, {
      documentId: input.documentId,
      embedding: createEmbeddingProvider(),
    });
  }
}

/**
 * Chunk + optional embed on publish. No fake embeddings when provider disconnected.
 */
export async function ingestPublishedDocumentChunks(
  client: Client,
  input: {
    documentId: string;
    embedding?: EmbeddingProvider;
  },
): Promise<{ chunkCount: number; embedded: boolean }> {
  const embedding = input.embedding ?? createEmbeddingProvider();

  const { data: doc, error: dErr } = await client
    .from("knowledge_documents")
    .select(
      "id, org_id, status, confidentiality_level, visibility, owner_user_id, department_id, project_id, origin_thread_id, source_type, contains_personal_conversation",
    )
    .eq("id", input.documentId)
    .single();
  if (dErr || !doc) throw new Error(dErr?.message ?? "document not found");
  if (doc.status !== "published") {
    throw new Error("Only published documents are ingested for retrieval");
  }
  if (doc.contains_personal_conversation) {
    throw new Error("Personal conversation content cannot enter org retrieval");
  }

  const { data: version, error: vErr } = await client
    .from("knowledge_document_versions")
    .select("id, body")
    .eq("document_id", input.documentId)
    .is("deleted_at", null)
    .order("version_number", { ascending: false })
    .limit(1)
    .single();
  if (vErr || !version) throw new Error(vErr?.message ?? "version not found");

  const drafts = splitKnowledgeBody(version.body);
  const { data: existingRows } = await client
    .from("knowledge_chunks")
    .select("id, content_hash, chunk_index")
    .eq("document_version_id", version.id)
    .is("deleted_at", null);

  const plan = planChunkUpserts({
    drafts,
    existing: (existingRows ?? []).map((r) => ({
      id: r.id,
      contentHash: r.content_hash ?? "",
      chunkIndex: r.chunk_index,
    })),
  });

  if (plan.toSoftDeleteIds.length) {
    await client
      .from("knowledge_chunks")
      .update({ deleted_at: new Date().toISOString() })
      .in("id", plan.toSoftDeleteIds);
  }

  for (const draft of plan.toUpsert) {
    const row = {
      document_version_id: version.id,
      document_id: doc.id,
      org_id: doc.org_id,
      chunk_index: draft.chunkIndex,
      content: draft.content,
      content_normalized: draft.contentNormalized,
      content_hash: draft.contentHash,
      token_count: draft.tokenCount,
      confidentiality_level: doc.confidentiality_level,
      visibility: doc.visibility,
      owner_user_id: doc.owner_user_id,
      department_id: doc.department_id,
      project_id: doc.project_id,
      origin_thread_id: doc.origin_thread_id,
      source_type: doc.source_type,
      contains_personal_conversation: false,
      source_metadata: { pipeline: "manual_publish" },
      updated_at: new Date().toISOString(),
      deleted_at: null as string | null,
      embedding: null as string | null,
      embedding_model: null as string | null,
      embedding_version: null as string | null,
      embedding_dimensions: null as number | null,
    };

    if (embedding.available) {
      try {
        const [vec] = await embedding.embedDocuments([draft.content]);
        if (vec && vec.values.length === embedding.dimensions) {
          row.embedding = JSON.stringify(vec.values);
          row.embedding_model = vec.modelId;
          row.embedding_version = vec.modelVersion;
          row.embedding_dimensions = vec.dimensions;
        }
      } catch {
        // Keep null embedding — lexical-only retrieval.
      }
    }

    const { error } = await client.from("knowledge_chunks").upsert(row, {
      onConflict: "document_version_id,chunk_index",
    });
    if (error) {
      // Partial unique index may not map to onConflict — fallback insert/update.
      const { data: hit } = await client
        .from("knowledge_chunks")
        .select("id")
        .eq("document_version_id", version.id)
        .eq("chunk_index", draft.chunkIndex)
        .is("deleted_at", null)
        .maybeSingle();
      if (hit?.id) {
        const { error: uErr } = await client
          .from("knowledge_chunks")
          .update(row)
          .eq("id", hit.id);
        if (uErr) throw new Error(uErr.message);
      } else {
        const { error: iErr } = await client.from("knowledge_chunks").insert(row);
        if (iErr) throw new Error(iErr.message);
      }
    }
  }

  return {
    chunkCount: drafts.length,
    embedded: embedding.available,
  };
}

export async function listManagedKnowledge(
  client: Client,
  orgId: string,
) {
  const { data, error } = await client
    .from("knowledge_documents")
    .select(
      "id, title, status, visibility, confidentiality_level, source_type, updated_at, published_at",
    )
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return data ?? [];
}
