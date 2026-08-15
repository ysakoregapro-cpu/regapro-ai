import "server-only";
import { isDevSampleMode } from "@/lib/supabase/env";
import type { ConfidentialityLevel } from "@regapro/shared";
import {
  appendUserMessage,
  changeThreadLevel,
  createDerivedResource,
  ensureAssistantReply,
  getThreadBundle,
  listVisibleThreads,
  startChatFromHome,
  type InheritedResource,
  type StartChatInput,
  type StartChatResult,
  type StoredMessage,
  type StoredThread,
} from "@/lib/application/chat-service";
import {
  attachFileToThread,
  processWorkflowAfterUserMessage,
  startConversationWorkflow,
} from "@/lib/application/conversation-workflow";
import {
  listArtifactsForThread,
  reviseArtifact,
  type StoredArtifact,
} from "@/lib/application/artifact-service";
import { listFilesForThread, getFileObject, getFileObjectBytes, type FileObjectMeta } from "@/lib/application/file-object-service";
import type {
  StartConversationInput,
  StartConversationResult,
} from "@/lib/application/workflow-types";
import {
  appendUserMessageLive,
  attachFileToThreadLive,
  changeThreadLevelLive,
  createDerivedResourceLive,
  ensureAssistantReplyLive,
  getThreadBundleLive,
  listFilesForThreadLive,
  listVisibleThreadsLive,
  processWorkflowAfterUserMessageLive,
  reviseArtifactLive,
  startChatFromHomeLive,
  startConversationWorkflowLive,
} from "@/lib/application/conversation-workflow-live";

/** Mode-aware conversation start (preserves sync API for tests via direct imports). */
export async function startConversationWorkflowAsync(
  input: StartConversationInput,
): Promise<StartConversationResult> {
  if (isDevSampleMode()) return startConversationWorkflow(input);
  return startConversationWorkflowLive(input);
}

export async function startChatFromHomeAsync(
  input: StartChatInput,
): Promise<StartChatResult> {
  if (isDevSampleMode()) return startChatFromHome(input);
  return startChatFromHomeLive(input);
}

export async function listVisibleThreadsAsync(): Promise<StoredThread[]> {
  if (isDevSampleMode()) return listVisibleThreads();
  return listVisibleThreadsLive();
}

export async function getThreadBundleAsync(threadId: string) {
  if (isDevSampleMode()) return getThreadBundle(threadId);
  return getThreadBundleLive(threadId);
}

export async function appendUserMessageAsync(input: {
  threadId: string;
  content: string;
  userId?: string;
}): Promise<
  | { ok: true; message: StoredMessage; messages: StoredMessage[] }
  | { ok: false; code: "THREAD_NOT_FOUND" | "EMPTY"; message: string }
> {
  if (isDevSampleMode()) return appendUserMessage(input);
  return appendUserMessageLive(input);
}

export async function ensureAssistantReplyAsync(input: {
  threadId: string;
  userId?: string;
  idempotencyKey?: string;
}) {
  if (isDevSampleMode()) return ensureAssistantReply(input);
  return ensureAssistantReplyLive(input);
}

export async function processWorkflowAfterUserMessageAsync(input: {
  threadId: string;
  messageId: string;
  content: string;
  userId?: string;
}) {
  if (isDevSampleMode()) return processWorkflowAfterUserMessage(input);
  return processWorkflowAfterUserMessageLive(input);
}

export async function createDerivedResourceAsync(input: {
  threadId: string;
  messageId?: string;
  kind: InheritedResource["kind"];
  title: string;
  userId?: string;
}): Promise<InheritedResource> {
  if (isDevSampleMode()) return createDerivedResource(input);
  return createDerivedResourceLive(input);
}

export async function changeThreadLevelAsync(input: {
  threadId: string;
  newLevel: ConfidentialityLevel;
  userId?: string;
}) {
  if (isDevSampleMode()) return changeThreadLevel(input);
  return changeThreadLevelLive(input);
}

export async function listFilesForThreadAsync(threadId: string) {
  if (isDevSampleMode()) return listFilesForThread(threadId);
  return listFilesForThreadLive(threadId);
}

export async function attachFileToThreadAsync(input: {
  threadId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  content?: Uint8Array;
  userId?: string;
  idempotencyKey?: string;
}): Promise<FileObjectMeta | { ok: false; message: string }> {
  if (isDevSampleMode()) {
    return attachFileToThread({
      threadId: input.threadId,
      name: input.name,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      content: input.content,
    });
  }
  if (!input.content) {
    return { ok: false, message: "ファイル本体が必要です" };
  }
  return attachFileToThreadLive({
    ...input,
    content: input.content,
  });
}

export async function downloadFileAsync(
  id: string,
): Promise<{ meta: FileObjectMeta; bytes: Uint8Array } | null> {
  if (isDevSampleMode()) {
    const meta = getFileObject(id);
    if (!meta) return null;
    const bytes = getFileObjectBytes(id);
    if (!bytes) return null;
    return { meta, bytes };
  }
  const { getSupabaseWorkUnitPersistence } = await import(
    "@/lib/data/persistence"
  );
  const persist = await getSupabaseWorkUnitPersistence();
  return persist.files.download(id);
}

export async function listArtifactsForThreadAsync(
  threadId: string,
): Promise<StoredArtifact[]> {
  if (isDevSampleMode()) return listArtifactsForThread(threadId);
  const { getSupabaseWorkUnitPersistence } = await import(
    "@/lib/data/persistence"
  );
  const persist = await getSupabaseWorkUnitPersistence();
  return persist.artifacts.listByThread(threadId);
}

export async function reviseArtifactAsync(input: {
  artifactId: string;
  instruction: string;
}): Promise<StoredArtifact | null> {
  if (isDevSampleMode()) return reviseArtifact(input);
  return reviseArtifactLive(input);
}

export async function listDocumentLibraryAsync(): Promise<StoredArtifact[]> {
  if (isDevSampleMode()) {
    const { listDocumentLibrary } = await import(
      "@/lib/application/artifact-service"
    );
    return listDocumentLibrary();
  }
  const { getSupabaseWorkUnitPersistence } = await import(
    "@/lib/data/persistence"
  );
  const persist = await getSupabaseWorkUnitPersistence();
  return persist.artifacts.listLibrary();
}

export async function listResearchRunsForThreadAsync(threadId: string) {
  if (isDevSampleMode()) {
    const { listResearchRunsForThread } = await import(
      "@/lib/application/research-service"
    );
    return listResearchRunsForThread(threadId);
  }
  const { getSupabaseWorkUnitPersistence } = await import(
    "@/lib/data/persistence"
  );
  const persist = await getSupabaseWorkUnitPersistence();
  return persist.research.listByThread(threadId);
}

export async function getResearchRunAsync(id: string) {
  if (isDevSampleMode()) {
    const { getResearchRun } = await import(
      "@/lib/application/research-service"
    );
    return getResearchRun(id);
  }
  const { getSupabaseWorkUnitPersistence } = await import(
    "@/lib/data/persistence"
  );
  const persist = await getSupabaseWorkUnitPersistence();
  return persist.research.get(id);
}

export async function listResearchLibraryAsync() {
  if (isDevSampleMode()) {
    const { listResearchLibrary } = await import(
      "@/lib/application/research-service"
    );
    return listResearchLibrary();
  }
  const { getSupabaseWorkUnitPersistence } = await import(
    "@/lib/data/persistence"
  );
  const persist = await getSupabaseWorkUnitPersistence();
  return persist.research.listLibrary();
}
