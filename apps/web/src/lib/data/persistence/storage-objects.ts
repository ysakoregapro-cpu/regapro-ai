/**
 * Authenticated Supabase Storage helpers (JWT / RLS — never service_role).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type StorageBucket =
  | "chat-attachments"
  | "artifacts"
  | "knowledge-files"
  | "research-snapshots";

export function buildOrgThreadFilePath(input: {
  orgId: string;
  threadId: string;
  fileId: string;
  filename: string;
}): string {
  const safe = sanitizeFilename(input.filename);
  return `org/${input.orgId}/threads/${input.threadId}/${input.fileId}/${safe}`;
}

export function buildArtifactExportPath(input: {
  orgId: string;
  artifactId: string;
  version: number;
  filename: string;
}): string {
  const safe = sanitizeFilename(input.filename);
  return `org/${input.orgId}/artifacts/${input.artifactId}/v${input.version}/${safe}`;
}

export function sanitizeFilename(name: string): string {
  const base = name.replace(/[/\\?%*:|"<>]/g, "_").trim() || "file";
  return base.slice(0, 180);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", copy);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function uploadObject(input: {
  client: SupabaseClient;
  bucket: StorageBucket;
  path: string;
  bytes: Uint8Array;
  contentType: string;
  upsert?: boolean;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await input.client.storage
    .from(input.bucket)
    .upload(input.path, input.bytes, {
      contentType: input.contentType,
      upsert: input.upsert ?? false,
    });
  if (error) {
    return { ok: false, message: error.message };
  }
  return { ok: true };
}

export async function downloadObject(input: {
  client: SupabaseClient;
  bucket: StorageBucket;
  path: string;
}): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; message: string }> {
  const { data, error } = await input.client.storage
    .from(input.bucket)
    .download(input.path);
  if (error || !data) {
    return { ok: false, message: error?.message ?? "download failed" };
  }
  const buf = new Uint8Array(await data.arrayBuffer());
  return { ok: true, bytes: buf };
}

export async function removeObject(input: {
  client: SupabaseClient;
  bucket: StorageBucket;
  path: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await input.client.storage
    .from(input.bucket)
    .remove([input.path]);
  if (error) {
    return { ok: false, message: error.message };
  }
  return { ok: true };
}

/**
 * Preferred order: metadata row first, then Storage upload.
 * If upload fails → soft-delete metadata (no orphan bytes).
 * Alternate order (upload then metadata): metadata fail → remove Storage via orphan DELETE policy.
 */
export async function compensateFailedUpload(input: {
  client: SupabaseClient;
  fileId: string;
  bucket: StorageBucket;
  path: string;
  phase: "after_metadata" | "after_storage";
}): Promise<void> {
  if (input.phase === "after_metadata") {
    await input.client
      .from("file_objects")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", input.fileId)
      .is("deleted_at", null);
    return;
  }
  await removeObject({
    client: input.client,
    bucket: input.bucket,
    path: input.path,
  });
}
