/**
 * Work-unit persistence ports.
 * Domain services must not import Supabase SDK — only adapters do.
 */
import type { ConfidentialityLevel, Visibility } from "@regapro/shared";
import type { StoredMessage, StoredThread, InheritedResource } from "@/lib/application/chat-service";
import type { StoredArtifact } from "@/lib/application/artifact-service";
import type { ResearchRun } from "@/lib/application/research-service";
import type { FileObjectMeta } from "@/lib/application/file-object-service";

export type PersistedTask = {
  id: string;
  orgId: string;
  title: string;
  description: string | null;
  status: string;
  projectId: string | null;
  createdBy: string;
  confidentialityLevel: ConfidentialityLevel;
  visibility: Visibility;
  originThreadId: string | null;
  originMessageId: string | null;
  createdAt: string;
  updatedAt: string;
};

export interface ChatPersistence {
  createThread(thread: StoredThread, ownerUserId: string): Promise<StoredThread>;
  updateThread(thread: StoredThread): Promise<StoredThread>;
  getThread(id: string): Promise<StoredThread | null>;
  listThreads(): Promise<StoredThread[]>;
  addParticipant(threadId: string, userId: string): Promise<void>;
  listParticipants(threadId: string): Promise<string[]>;
  appendMessage(message: StoredMessage, authorId: string): Promise<StoredMessage>;
  listMessages(threadId: string): Promise<StoredMessage[]>;
  findIdempotency(
    key: string,
  ): Promise<{ threadId: string; messageId: string } | null>;
  saveIdempotency(
    key: string,
    value: { threadId: string; messageId: string },
  ): Promise<void>;
  findReplyIdempotency(key: string): Promise<string | null>;
  saveReplyIdempotency(key: string, messageId: string): Promise<void>;
}

export interface TaskPersistence {
  create(task: PersistedTask): Promise<PersistedTask>;
  get(id: string): Promise<PersistedTask | null>;
  listByThread(threadId: string): Promise<PersistedTask[]>;
  listAccessible(): Promise<PersistedTask[]>;
  update(
    id: string,
    patch: Partial<Pick<PersistedTask, "title" | "description" | "status">>,
  ): Promise<PersistedTask | null>;
}

export interface ArtifactPersistence {
  create(artifact: StoredArtifact, orgId: string, createdBy: string): Promise<StoredArtifact>;
  update(artifact: StoredArtifact): Promise<StoredArtifact>;
  get(id: string): Promise<StoredArtifact | null>;
  listByThread(threadId: string): Promise<StoredArtifact[]>;
  listLibrary(): Promise<StoredArtifact[]>;
}

export interface ResearchPersistence {
  create(run: ResearchRun): Promise<ResearchRun>;
  update(run: ResearchRun): Promise<ResearchRun>;
  get(id: string): Promise<ResearchRun | null>;
  listByThread(threadId: string): Promise<ResearchRun[]>;
  listLibrary(): Promise<ResearchRun[]>;
  findByIdempotencyKey(key: string): Promise<ResearchRun | null>;
  saveIdempotency(key: string, runId: string): Promise<void>;
}

export interface FileObjectPersistence {
  create(
    file: FileObjectMeta,
    meta: {
      orgId: string;
      createdBy: string;
      bucket?: string;
      path?: string;
      /** Required for durable supabase uploads. */
      content?: Uint8Array;
    },
  ): Promise<FileObjectMeta>;
  get(id: string): Promise<FileObjectMeta | null>;
  listByThread(threadId: string): Promise<FileObjectMeta[]>;
  download(
    id: string,
  ): Promise<{ meta: FileObjectMeta; bytes: Uint8Array } | null>;
}

export interface DerivedResourcePersistence {
  create(resource: InheritedResource): Promise<InheritedResource>;
  listByThread(threadId: string): Promise<InheritedResource[]>;
}

export interface WorkUnitPersistence {
  chat: ChatPersistence;
  tasks: TaskPersistence;
  artifacts: ArtifactPersistence;
  research: ResearchPersistence;
  files: FileObjectPersistence;
  derived: DerivedResourcePersistence;
}
