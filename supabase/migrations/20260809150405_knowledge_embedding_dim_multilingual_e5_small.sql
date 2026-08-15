-- =============================================================================
-- Align knowledge_chunks.embedding dimension to the selected local embedding model.
--
-- Audit decision (Local Embedding Runtime Phase):
--   Runtime: Node / @huggingface/transformers (Transformers.js)
--   Model:   Xenova/multilingual-e5-small (ONNX of intfloat/multilingual-e5-small)
--   Dims:    384 (NOT the provisional vector(1536) from schema bootstrap)
--
-- Applied migrations are never edited. Previous 1536 vectors (if any) are cleared
-- because they are not compatible with this model — no fake re-projection.
-- =============================================================================

-- Clear incompatible embeddings before type change.
UPDATE public.knowledge_chunks
SET
  embedding = NULL,
  embedding_model = NULL,
  embedding_version = NULL
WHERE embedding IS NOT NULL;

DROP INDEX IF EXISTS public.knowledge_chunks_embedding_hnsw_idx;

ALTER TABLE public.knowledge_chunks
  ALTER COLUMN embedding TYPE vector(384)
  USING NULL;

ALTER TABLE public.knowledge_chunks
  ADD COLUMN IF NOT EXISTS embedding_dimensions integer;

COMMENT ON COLUMN public.knowledge_chunks.embedding IS
  'Semantic embedding. Dimension must match active EmbeddingProvider (currently 384 for Xenova/multilingual-e5-small).';

COMMENT ON COLUMN public.knowledge_chunks.embedding_dimensions IS
  'Declared vector length written at embed time for mismatch detection.';

CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_hnsw_idx
  ON public.knowledge_chunks
  USING hnsw (embedding vector_cosine_ops)
  WHERE deleted_at IS NULL AND embedding IS NOT NULL;

-- Recreate vector search RPC for 384-d. Security pre-filter unchanged.
CREATE OR REPLACE FUNCTION public.regapro_knowledge_vector_search(
  p_query_embedding vector(384),
  p_limit int DEFAULT 40
)
RETURNS TABLE (
  chunk_id uuid,
  document_id uuid,
  document_title text,
  content text,
  confidentiality_level smallint,
  visibility text,
  org_id uuid,
  project_id uuid,
  department_id uuid,
  owner_user_id uuid,
  source_type text,
  updated_at timestamptz,
  vector_rank int,
  vector_score double precision
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH candidates AS (
    SELECT
      c.id AS chunk_id,
      c.document_id,
      d.title AS document_title,
      c.content,
      c.confidentiality_level,
      c.visibility,
      c.org_id,
      c.project_id,
      c.department_id,
      c.owner_user_id,
      COALESCE(c.source_type, d.source_type) AS source_type,
      COALESCE(c.updated_at, c.created_at) AS updated_at,
      (1.0 - (c.embedding <=> p_query_embedding))::double precision AS vector_score
    FROM public.knowledge_chunks c
    JOIN public.knowledge_documents d ON d.id = c.document_id
    WHERE c.embedding IS NOT NULL
      AND COALESCE(c.embedding_dimensions, 384) = 384
      AND public.regapro_knowledge_chunk_retrievable(c.id)
  ),
  ranked AS (
    SELECT
      candidates.*,
      row_number() OVER (ORDER BY candidates.vector_score DESC, candidates.chunk_id)::int AS vector_rank
    FROM candidates
  )
  SELECT
    chunk_id,
    document_id,
    document_title,
    content,
    confidentiality_level,
    visibility,
    org_id,
    project_id,
    department_id,
    owner_user_id,
    source_type,
    updated_at,
    vector_rank,
    vector_score
  FROM ranked
  WHERE vector_rank <= GREATEST(1, LEAST(COALESCE(p_limit, 40), 100));
$$;

REVOKE ALL ON FUNCTION public.regapro_knowledge_vector_search(vector, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.regapro_knowledge_vector_search(vector, int) TO authenticated;

-- Drop old 1536 overload signature if Postgres kept both.
DO $$
BEGIN
  DROP FUNCTION IF EXISTS public.regapro_knowledge_vector_search(vector(1536), int);
EXCEPTION
  WHEN undefined_function THEN NULL;
END $$;

COMMENT ON FUNCTION public.regapro_knowledge_vector_search(vector, int) IS
  'pgvector cosine retrieval (384-d multilingual-e5-small). Security pre-filter before ranking.';
