import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  KnowledgeSearchHit,
  KnowledgeSearchPort,
} from "@regapro/ai-runtime";
import type { AccessContext } from "@regapro/security";
import type { Database } from "@/lib/supabase/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<Database, "public", any>;
type RpcLexicalRow = {
  chunk_id: string;
  document_id: string;
  document_title: string;
  content: string;
  confidentiality_level: number;
  visibility: string;
  org_id: string;
  project_id: string | null;
  department_id: string | null;
  owner_user_id: string | null;
  source_type: string | null;
  updated_at: string | null;
  lexical_rank: number;
  lexical_score: number;
};

type RpcVectorRow = {
  chunk_id: string;
  document_id: string;
  document_title: string;
  content: string;
  confidentiality_level: number;
  visibility: string;
  org_id: string;
  project_id: string | null;
  department_id: string | null;
  owner_user_id: string | null;
  source_type: string | null;
  updated_at: string | null;
  vector_rank: number;
  vector_score: number;
};

function mapLexical(row: RpcLexicalRow): KnowledgeSearchHit {
  return {
    chunkId: row.chunk_id,
    documentId: row.document_id,
    documentTitle: row.document_title,
    content: row.content,
    confidentialityLevel: row.confidentiality_level,
    visibility: row.visibility,
    ownerUserId: row.owner_user_id,
    projectId: row.project_id,
    departmentId: row.department_id,
    sourceType: row.source_type,
    updatedAt: row.updated_at,
    rank: row.lexical_rank,
    score: row.lexical_score,
  };
}

function mapVector(row: RpcVectorRow): KnowledgeSearchHit {
  return {
    chunkId: row.chunk_id,
    documentId: row.document_id,
    documentTitle: row.document_title,
    content: row.content,
    confidentialityLevel: row.confidentiality_level,
    visibility: row.visibility,
    ownerUserId: row.owner_user_id,
    projectId: row.project_id,
    departmentId: row.department_id,
    sourceType: row.source_type,
    updatedAt: row.updated_at,
    rank: row.vector_rank,
    score: row.vector_score,
  };
}

/**
 * Authenticated user-JWT Supabase adapter.
 * Never uses service_role for normal retrieval.
 */
export function createSupabaseKnowledgeSearchPort(
  client: Client,
): KnowledgeSearchPort {
  return {
    async lexicalSearch(input: {
      access: AccessContext;
      query: string;
      limit: number;
    }) {
      if (
        !input.access?.userId ||
        !input.access.organizationId ||
        input.access.auditMode
      ) {
        return [];
      }
      const { data, error } = await client.rpc(
        "regapro_knowledge_lexical_search",
        {
          p_query: input.query,
          p_limit: input.limit,
        },
      );
      if (error) {
        console.error("[knowledge] lexical search failed", error.message);
        return [];
      }
      return ((data ?? []) as RpcLexicalRow[])
        .filter((r) => r.org_id === input.access.organizationId)
        .map(mapLexical);
    },

    async vectorSearch(input: {
      access: AccessContext;
      queryEmbedding: number[];
      limit: number;
    }) {
      if (
        !input.access?.userId ||
        !input.access.organizationId ||
        input.access.auditMode
      ) {
        return [];
      }
      const { data, error } = await client.rpc(
        "regapro_knowledge_vector_search",
        {
          p_query_embedding: JSON.stringify(input.queryEmbedding),
          p_limit: input.limit,
        },
      );
      if (error) {
        console.error("[knowledge] vector search failed", error.message);
        return [];
      }
      return ((data ?? []) as RpcVectorRow[])
        .filter((r) => r.org_id === input.access.organizationId)
        .map(mapVector);
    },
  };
}
