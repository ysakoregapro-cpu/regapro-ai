import type { ConfidentialityLevel, Visibility } from "@regapro/shared";

const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED_MIME = [
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/png",
  "image/jpeg",
  "application/octet-stream",
];

export type FileObjectMeta = {
  id: string;
  threadId: string;
  messageId: string | null;
  name: string;
  mimeType: string;
  sizeBytes: number;
  confidentialityLevel: ConfidentialityLevel;
  visibility: Visibility;
  storageMode: "dev-sample-ephemeral" | "supabase";
  createdAt: string;
  ephemeralNotice: string | null;
};

type Store = {
  files: Map<string, FileObjectMeta>;
  byThread: Map<string, string[]>;
};

const g = globalThis as unknown as { __regaproFileStore?: Store };

function store(): Store {
  if (!g.__regaproFileStore) {
    g.__regaproFileStore = { files: new Map(), byThread: new Map() };
  }
  return g.__regaproFileStore;
}

export function validateFileUpload(input: {
  mimeType: string;
  sizeBytes: number;
}): { ok: true } | { ok: false; message: string } {
  if (input.sizeBytes > MAX_BYTES) {
    return { ok: false, message: "ファイルサイズは20MBまでです" };
  }
  if (!ALLOWED_MIME.includes(input.mimeType) && !input.mimeType.startsWith("text/")) {
    return { ok: false, message: "対応していない形式です" };
  }
  return { ok: true };
}

export function createFileObject(input: {
  id?: string;
  threadId: string;
  messageId: string | null;
  name: string;
  mimeType: string;
  sizeBytes: number;
  confidentialityLevel: ConfidentialityLevel;
  visibility: Visibility;
  storageMode: "dev-sample-ephemeral" | "supabase";
}): FileObjectMeta {
  const check = validateFileUpload({
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
  });
  if (!check.ok) {
    throw new Error(check.message);
  }
  const file: FileObjectMeta = {
    id: input.id ?? globalThis.crypto.randomUUID(),
    threadId: input.threadId,
    messageId: input.messageId,
    name: input.name,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    confidentialityLevel: input.confidentialityLevel,
    visibility: input.visibility,
    storageMode: input.storageMode,
    createdAt: new Date().toISOString(),
    ephemeralNotice:
      input.storageMode === "dev-sample-ephemeral"
        ? "確認用のため、再起動後は消える場合があります。本番保存ではありません。"
        : null,
  };
  const s = store();
  s.files.set(file.id, file);
  const list = s.byThread.get(input.threadId) ?? [];
  list.push(file.id);
  s.byThread.set(input.threadId, list);
  return file;
}

export function listFilesForThread(threadId: string) {
  const ids = store().byThread.get(threadId) ?? [];
  return ids
    .map((id) => store().files.get(id))
    .filter((f): f is FileObjectMeta => Boolean(f));
}

export function getFileObject(id: string) {
  return store().files.get(id) ?? null;
}

export function __resetFileStoreForTests() {
  delete (globalThis as { __regaproFileStore?: Store }).__regaproFileStore;
}
