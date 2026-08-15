import type { SupabaseClient } from "@supabase/supabase-js";
import type { Citation } from "@regapro/ai-runtime";
import type { Database } from "@/lib/supabase/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<Database, "public", any>;

/**
 * Persist assistant answer citations. Chunk body is never stored here —
 * only titles / excerpts the user already could retrieve via RLS.
 */
export async function persistMessageCitations(
  client: Client,
  input: {
    messageId: string;
    citations: Citation[];
  },
): Promise<void> {
  if (!input.citations.length) return;

  const rows = input.citations.map((c) => ({
    message_id: input.messageId,
    chunk_id:
      c.sourceType === "knowledge_chunk"
        ? extractChunkId(c.uri) ?? null
        : null,
    document_id:
      c.sourceType === "knowledge" || c.sourceType === "knowledge_chunk"
        ? c.sourceId
        : null,
    source_title: c.title.slice(0, 500),
    source_url: c.uri,
    source_type: c.sourceType,
    excerpt: c.excerpt.slice(0, 500),
    relevance: c.relevance,
  }));

  const { error } = await client.from("message_citations").insert(rows);
  if (error) {
    console.error("[citations] persist failed", error.message);
  }
}

function extractChunkId(uri: string | null): string | null {
  if (!uri) return null;
  const m = uri.match(/\/chunk\/([0-9a-f-]{36})/i);
  return m?.[1] ?? null;
}

export type PersistedCitationView = {
  id: string;
  title: string;
  source: string;
  excerpt: string | null;
  chunkId: string | null;
  documentId: string | null;
};

/**
 * Reload citations for messages. If chunk is no longer readable under RLS,
 * drop content — never leak unauthorized knowledge via citation join.
 */
export async function loadMessageCitations(
  client: Client,
  messageIds: string[],
): Promise<Map<string, PersistedCitationView[]>> {
  const map = new Map<string, PersistedCitationView[]>();
  if (!messageIds.length) return map;

  const { data, error } = await client
    .from("message_citations")
    .select(
      "id, message_id, source_title, source_url, source_type, excerpt, chunk_id, document_id",
    )
    .in("message_id", messageIds)
    .is("deleted_at", null);
  if (error || !data) return map;

  // Optional: verify chunk still SELECT-able (RLS). Missing rows = filtered out.
  const chunkIds = [
    ...new Set(data.map((r) => r.chunk_id).filter(Boolean) as string[]),
  ];
  const readableChunks = new Set<string>();
  if (chunkIds.length) {
    const { data: chunks } = await client
      .from("knowledge_chunks")
      .select("id")
      .in("id", chunkIds)
      .is("deleted_at", null);
    for (const c of chunks ?? []) readableChunks.add(c.id);
  }

  for (const row of data) {
    if (row.chunk_id && !readableChunks.has(row.chunk_id)) {
      // Keep title-only citation shell without excerpt/body when unauthorized.
      const safe: PersistedCitationView = {
        id: row.id,
        title: row.source_title ?? "参照元",
        source: row.source_type ?? "knowledge",
        excerpt: null,
        chunkId: null,
        documentId: null,
      };
      const list = map.get(row.message_id) ?? [];
      list.push(safe);
      map.set(row.message_id, list);
      continue;
    }
    const view: PersistedCitationView = {
      id: row.id,
      title: row.source_title ?? "参照元",
      source: row.source_type ?? "knowledge",
      excerpt: row.excerpt,
      chunkId: row.chunk_id,
      documentId: row.document_id,
    };
    const list = map.get(row.message_id) ?? [];
    list.push(view);
    map.set(row.message_id, list);
  }
  return map;
}
