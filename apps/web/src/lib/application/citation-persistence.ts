import type { SupabaseClient } from "@supabase/supabase-js";
import type { Citation } from "@regapro/ai-runtime";
import type { Database } from "@/lib/supabase/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<Database, "public", any>;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string | null | undefined): value is string {
  return Boolean(value && UUID_RE.test(value));
}

export function extractChunkId(uri: string | null): string | null {
  if (!uri) return null;
  const m = uri.match(/\/chunk\/([0-9a-f-]{36})/i);
  return m?.[1] ?? null;
}

export function citationSourceLabel(input: {
  sourceType: string | null;
  sourceUrl: string | null;
}): string {
  if (input.sourceType === "web" || input.sourceType === "research") {
    if (input.sourceUrl) {
      try {
        return new URL(input.sourceUrl).hostname.replace(/^www\./, "") || "外部情報";
      } catch {
        return "外部情報";
      }
    }
    return "外部情報";
  }
  return "社内情報";
}

/**
 * Persist assistant answer citations. Chunk body is never stored here —
 * only titles / excerpts the user already could retrieve via RLS.
 * Returns the number of rows inserted (0 on skip or failure).
 */
export async function persistMessageCitations(
  client: Client,
  input: {
    messageId: string;
    citations: Citation[];
  },
): Promise<number> {
  if (!input.citations.length) return 0;

  const rows = input.citations.map((c) => {
    const chunkId =
      c.sourceType === "knowledge_chunk" ? extractChunkId(c.uri) : null;
    const documentId =
      c.sourceType === "knowledge" || c.sourceType === "knowledge_chunk"
        ? c.sourceId
        : null;
    return {
      message_id: input.messageId,
      chunk_id: isUuid(chunkId) ? chunkId : null,
      document_id: isUuid(documentId) ? documentId : null,
      source_title: c.title.slice(0, 500),
      source_url: c.uri,
      source_type: c.sourceType,
      excerpt: c.excerpt.slice(0, 500),
      relevance: c.relevance,
    };
  });

  const { error } = await client.from("message_citations").insert(rows);
  if (error) {
    console.error("[citations] persist failed", error.message);
    return 0;
  }
  return rows.length;
}

export type PersistedCitationView = {
  id: string;
  title: string;
  source: string;
  excerpt: string | null;
  uri: string | null;
  chunkId: string | null;
  documentId: string | null;
  provenance: "internal" | "web";
};

export function toCitationView(row: {
  id: string;
  source_title: string | null;
  source_url: string | null;
  source_type: string | null;
  excerpt: string | null;
  chunk_id: string | null;
  document_id: string | null;
}): PersistedCitationView {
  const provenance: "internal" | "web" =
    row.source_type === "web" || row.source_type === "research"
      ? "web"
      : "internal";
  return {
    id: row.id,
    title: row.source_title ?? "参照元",
    source: citationSourceLabel({
      sourceType: row.source_type,
      sourceUrl: row.source_url,
    }),
    excerpt: row.excerpt,
    uri: row.source_url,
    chunkId: row.chunk_id,
    documentId: row.document_id,
    provenance,
  };
}

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
    const view = toCitationView(row);
    if (row.chunk_id && !readableChunks.has(row.chunk_id)) {
      const safe: PersistedCitationView = {
        ...view,
        excerpt: null,
        chunkId: null,
        documentId: null,
      };
      const list = map.get(row.message_id) ?? [];
      list.push(safe);
      map.set(row.message_id, list);
      continue;
    }
    const list = map.get(row.message_id) ?? [];
    list.push(view);
    map.set(row.message_id, list);
  }
  return map;
}
