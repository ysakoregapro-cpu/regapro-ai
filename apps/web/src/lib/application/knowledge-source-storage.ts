import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildKnowledgeSourceStoragePath,
  KNOWLEDGE_SOURCES_BUCKET,
} from "@regapro/knowledge";
import {
  compensateFailedUpload,
  sha256Hex,
  uploadObject,
  type StorageBucket,
} from "@/lib/data/persistence/storage-objects";
import type { Database } from "@/lib/supabase/types";
import { confidentialityRank, type ConfidentialityLevel, type Visibility } from "@regapro/shared";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<Database, "public", any>;

export async function storeKnowledgeSourceOriginal(input: {
  client: Client;
  orgId: string;
  userId: string;
  sourceId: string;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  confidentialityLevel: ConfidentialityLevel;
  visibility: Visibility;
}): Promise<{ fileObjectId: string; path: string; checksum: string; size: number }> {
  const bucket = KNOWLEDGE_SOURCES_BUCKET as StorageBucket;
  const path = buildKnowledgeSourceStoragePath({
    orgId: input.orgId,
    sourceId: input.sourceId,
    filename: input.filename,
  });
  const checksum = await sha256Hex(input.bytes);
  const fileId = globalThis.crypto.randomUUID();

  const { error: metaErr } = await input.client.from("file_objects").insert({
    id: fileId,
    org_id: input.orgId,
    bucket,
    path,
    mime_type: input.mimeType,
    size_bytes: input.bytes.byteLength,
    checksum,
    created_by: input.userId,
    confidentiality_level: confidentialityRank(input.confidentialityLevel),
    visibility: input.visibility,
    original_filename: input.filename,
  });
  if (metaErr) throw new Error(metaErr.message);

  const uploaded = await uploadObject({
    client: input.client as never,
    bucket,
    path,
    bytes: input.bytes,
    contentType: input.mimeType,
    upsert: false,
  });
  if (!uploaded.ok) {
    await compensateFailedUpload({
      client: input.client as never,
      fileId,
      bucket,
      path,
      phase: "after_metadata",
    });
    throw new Error(uploaded.message);
  }

  return {
    fileObjectId: fileId,
    path,
    checksum,
    size: input.bytes.byteLength,
  };
}

export async function compensateKnowledgeSourceOrphan(input: {
  client: Client;
  fileObjectId: string;
  path: string;
}): Promise<void> {
  await compensateFailedUpload({
    client: input.client as never,
    fileId: input.fileObjectId,
    bucket: KNOWLEDGE_SOURCES_BUCKET as StorageBucket,
    path: input.path,
    phase: "after_storage",
  });
  await compensateFailedUpload({
    client: input.client as never,
    fileId: input.fileObjectId,
    bucket: KNOWLEDGE_SOURCES_BUCKET as StorageBucket,
    path: input.path,
    phase: "after_metadata",
  });
}
