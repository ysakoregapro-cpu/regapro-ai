import type { ConfidentialityLevel } from "@regapro/shared";
import type { StoredMessage, StoredThread } from "@/lib/application/chat-service";

export type ThreadListItem = Pick<
  StoredThread,
  | "id"
  | "title"
  | "projectId"
  | "confidentialityLevel"
  | "visibility"
  | "updatedAt"
  | "createdAt"
  | "ownerUserId"
>;

export async function fetchThreadList(): Promise<ThreadListItem[]> {
  const res = await fetch("/api/chat/threads", { cache: "no-store" });
  if (!res.ok) return [];
  const data = (await res.json()) as { threads?: ThreadListItem[] };
  return data.threads ?? [];
}

export async function fetchThreadBundle(threadId: string): Promise<{
  thread: StoredThread;
  messages: StoredMessage[];
} | null> {
  const res = await fetch(`/api/chat/threads/${threadId}`, { cache: "no-store" });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    ok: boolean;
    thread: StoredThread;
    messages: StoredMessage[];
  };
  if (!data.ok) return null;
  return { thread: data.thread, messages: data.messages };
}

export async function ensureThreadReply(
  threadId: string,
  idempotencyKey?: string,
): Promise<{
  messages: StoredMessage[];
  created: boolean;
} | null> {
  const res = await fetch(`/api/chat/threads/${threadId}/reply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify({ idempotencyKey }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    ok: boolean;
    messages: StoredMessage[];
    created: boolean;
  };
  if (!data.ok) return null;
  return { messages: data.messages, created: data.created };
}

export async function createDerivedViaApi(input: {
  threadId: string;
  messageId?: string;
  kind: "task" | "artifact" | "research" | "prompt" | "knowledge_candidate";
  title: string;
}) {
  const res = await fetch("/api/chat/derived", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return res.json() as Promise<{ ok: boolean }>;
}

export type { ConfidentialityLevel };
