import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { ChatPersistence } from "./ports";
import type { StoredMessage, StoredThread } from "@/lib/application/chat-service";
import {
  messageFromRow,
  messageToInsert,
  threadFromRow,
  threadToInsert,
} from "./mappers";

/** Process-local idempotency (survives within server instance). */
const idempotency = new Map<string, { threadId: string; messageId: string }>();
const replyIdempotency = new Map<string, string>();

type Client = SupabaseClient<Database>;

export function createSupabaseChatPersistence(client: Client): ChatPersistence {
  return {
    async createThread(thread, ownerUserId) {
      const { data, error } = await client
        .from("chat_threads")
        .insert(threadToInsert({ ...thread, ownerUserId }))
        .select("*")
        .single();
      if (error || !data) {
        throw new Error(`chat_threads insert failed: ${error?.message}`);
      }
      await client.from("chat_participants").upsert(
        {
          thread_id: thread.id,
          user_id: ownerUserId,
        },
        { onConflict: "thread_id,user_id" },
      );
      return threadFromRow(data);
    },

    async updateThread(thread) {
      const { data, error } = await client
        .from("chat_threads")
        .update({
          title: thread.title,
          confidentiality_level: threadToInsert(thread).confidentiality_level,
          visibility: thread.visibility,
          minimum_derived_level: threadToInsert(thread).minimum_derived_level,
          contains_sensitive_content: thread.containsSensitiveContent,
          security_label_source: thread.securityLabelSource,
          updated_at: thread.updatedAt,
          project_id: thread.projectId,
          department_id: thread.departmentId,
        })
        .eq("id", thread.id)
        .select("*")
        .single();
      if (error || !data) {
        throw new Error(`chat_threads update failed: ${error?.message}`);
      }
      return threadFromRow(data);
    },

    async getThread(id) {
      const { data, error } = await client
        .from("chat_threads")
        .select("*")
        .eq("id", id)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? threadFromRow(data) : null;
    },

    async listThreads() {
      const { data, error } = await client
        .from("chat_threads")
        .select("*")
        .is("deleted_at", null)
        .order("updated_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []).map(threadFromRow);
    },

    async addParticipant(threadId, userId) {
      const { error } = await client.from("chat_participants").upsert(
        { thread_id: threadId, user_id: userId },
        { onConflict: "thread_id,user_id" },
      );
      if (error) throw new Error(error.message);
    },

    async listParticipants(threadId) {
      const { data, error } = await client
        .from("chat_participants")
        .select("user_id")
        .eq("thread_id", threadId)
        .is("deleted_at", null);
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => r.user_id);
    },

    async appendMessage(message, authorId) {
      const { data, error } = await client
        .from("chat_messages")
        .insert(messageToInsert(message, authorId))
        .select("*")
        .single();
      if (error || !data) {
        throw new Error(`chat_messages insert failed: ${error?.message}`);
      }
      await client
        .from("chat_threads")
        .update({ updated_at: message.createdAt })
        .eq("id", message.threadId);
      return messageFromRow(data);
    },

    async listMessages(threadId) {
      const { data, error } = await client
        .from("chat_messages")
        .select("*")
        .eq("thread_id", threadId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      const messages = (data ?? []).map(messageFromRow);
      try {
        const { loadMessageCitations } = await import(
          "@/lib/application/citation-persistence"
        );
        const byMessage = await loadMessageCitations(
          client,
          messages.map((m) => m.id),
        );
        for (const msg of messages) {
          const cites = byMessage.get(msg.id);
          if (cites?.length) {
            msg.citations = cites.map((c) => ({
              id: c.id,
              title: c.title,
              source: c.source,
              excerpt: c.excerpt,
              chunkId: c.chunkId,
              documentId: c.documentId,
            }));
          }
        }
      } catch {
        // Citations are best-effort on load.
      }
      return messages;
    },

    async findIdempotency(key) {
      return idempotency.get(key) ?? null;
    },

    async saveIdempotency(key, value) {
      idempotency.set(key, value);
    },

    async findReplyIdempotency(key) {
      return replyIdempotency.get(key) ?? null;
    },

    async saveReplyIdempotency(key, messageId) {
      replyIdempotency.set(key, messageId);
    },
  };
}

export type { StoredMessage, StoredThread };
