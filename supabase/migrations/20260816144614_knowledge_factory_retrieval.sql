-- Knowledge Factory follow-up: retrieval freshness fields, conversation capture
-- policies, review authorization. Does not edit prior migrations.

GRANT SELECT, INSERT, UPDATE ON TABLE public.knowledge_domain_catalog TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.knowledge_ingestion_jobs TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.knowledge_source_chunks TO authenticated;
GRANT SELECT, INSERT ON TABLE public.knowledge_candidate_reviews TO authenticated;
GRANT SELECT, INSERT ON TABLE public.knowledge_document_domains TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.knowledge_training_candidates TO authenticated;

GRANT ALL ON TABLE public.knowledge_domain_catalog TO service_role;
GRANT ALL ON TABLE public.knowledge_ingestion_jobs TO service_role;
GRANT ALL ON TABLE public.knowledge_source_chunks TO service_role;
GRANT ALL ON TABLE public.knowledge_candidate_reviews TO service_role;
GRANT ALL ON TABLE public.knowledge_document_domains TO service_role;
GRANT ALL ON TABLE public.knowledge_training_candidates TO service_role;

-- Conversation capture: org members with knowledge:read may create a source they own.
DROP POLICY IF EXISTS knowledge_sources_insert ON public.knowledge_sources;
CREATE POLICY knowledge_sources_insert ON public.knowledge_sources
  FOR INSERT TO authenticated
  WITH CHECK (
    public.regapro_has_permission(org_id, 'knowledge:write')
    OR (
      origin_kind = 'conversation'
      AND owner_user_id = auth.uid()
      AND public.regapro_has_permission(org_id, 'knowledge:read')
    )
  );

DROP POLICY IF EXISTS knowledge_ingestion_jobs_insert ON public.knowledge_ingestion_jobs;
CREATE POLICY knowledge_ingestion_jobs_insert ON public.knowledge_ingestion_jobs
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND (
      public.regapro_has_permission(org_id, 'knowledge:write')
      OR (
        public.regapro_has_permission(org_id, 'knowledge:read')
        AND EXISTS (
          SELECT 1 FROM public.knowledge_sources s
          WHERE s.id = source_id
            AND s.origin_kind = 'conversation'
            AND s.owner_user_id = auth.uid()
        )
      )
    )
  );

DROP POLICY IF EXISTS knowledge_ingestion_jobs_update ON public.knowledge_ingestion_jobs;
CREATE POLICY knowledge_ingestion_jobs_update ON public.knowledge_ingestion_jobs
  FOR UPDATE TO authenticated
  USING (
    public.regapro_has_permission(org_id, 'knowledge:write')
    OR created_by = auth.uid()
  )
  WITH CHECK (
    public.regapro_has_permission(org_id, 'knowledge:write')
    OR created_by = auth.uid()
  );

DROP POLICY IF EXISTS knowledge_source_chunks_write ON public.knowledge_source_chunks;
CREATE POLICY knowledge_source_chunks_write ON public.knowledge_source_chunks
  FOR INSERT TO authenticated
  WITH CHECK (
    public.regapro_has_permission(org_id, 'knowledge:write')
    OR EXISTS (
      SELECT 1 FROM public.knowledge_sources s
      WHERE s.id = source_id
        AND s.origin_kind = 'conversation'
        AND s.owner_user_id = auth.uid()
        AND public.regapro_has_permission(s.org_id, 'knowledge:read')
    )
  );

DROP POLICY IF EXISTS knowledge_source_chunks_update ON public.knowledge_source_chunks;
CREATE POLICY knowledge_source_chunks_update ON public.knowledge_source_chunks
  FOR UPDATE TO authenticated
  USING (
    public.regapro_has_permission(org_id, 'knowledge:write')
    OR EXISTS (
      SELECT 1 FROM public.knowledge_sources s
      WHERE s.id = source_id
        AND s.origin_kind = 'conversation'
        AND s.owner_user_id = auth.uid()
    )
  )
  WITH CHECK (
    public.regapro_has_permission(org_id, 'knowledge:write')
    OR EXISTS (
      SELECT 1 FROM public.knowledge_sources s
      WHERE s.id = source_id
        AND s.origin_kind = 'conversation'
        AND s.owner_user_id = auth.uid()
    )
  );

-- Review actions require review/approve. Write is not enough.
DROP POLICY IF EXISTS knowledge_candidate_reviews_insert ON public.knowledge_candidate_reviews;
CREATE POLICY knowledge_candidate_reviews_insert ON public.knowledge_candidate_reviews
  FOR INSERT TO authenticated
  WITH CHECK (
    reviewer_id = auth.uid()
    AND (
      public.regapro_has_permission(org_id, 'knowledge:review')
      OR public.regapro_has_permission(org_id, 'knowledge:approve')
    )
  );

-- ---------------------------------------------------------------------------
-- Retrieval RPCs: expose current/historical + domains. Prefer current in ORDER BY.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.regapro_knowledge_lexical_search(text, int);

CREATE FUNCTION public.regapro_knowledge_lexical_search(
  p_query text,
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
  lexical_rank int,
  lexical_score double precision,
  is_current boolean,
  fact_status text,
  domain_keys text[]
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH prepared AS (
    SELECT trim(p_query) AS q
  ),
  candidates AS (
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
      COALESCE(d.is_current, true) AS is_current,
      COALESCE(d.fact_status, 'fact') AS fact_status,
      COALESCE(d.domain_keys, ARRAY['company_common']::text[]) AS domain_keys,
      GREATEST(
        similarity(COALESCE(c.content_normalized, c.content), (SELECT q FROM prepared)),
        word_similarity((SELECT q FROM prepared), COALESCE(c.content_normalized, c.content))
      )::double precision AS lexical_score
    FROM public.knowledge_chunks c
    JOIN public.knowledge_documents d ON d.id = c.document_id
    CROSS JOIN prepared
    WHERE prepared.q <> ''
      AND public.regapro_knowledge_chunk_retrievable(c.id)
      AND GREATEST(
        similarity(COALESCE(c.content_normalized, c.content), prepared.q),
        word_similarity(prepared.q, COALESCE(c.content_normalized, c.content))
      ) > 0.08
  ),
  ranked AS (
    SELECT
      candidates.*,
      row_number() OVER (
        ORDER BY candidates.is_current DESC, candidates.lexical_score DESC, candidates.chunk_id
      )::int AS lexical_rank
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
    lexical_rank,
    lexical_score,
    is_current,
    fact_status,
    domain_keys
  FROM ranked
  WHERE lexical_rank <= GREATEST(1, LEAST(COALESCE(p_limit, 40), 100));
$$;

REVOKE ALL ON FUNCTION public.regapro_knowledge_lexical_search(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.regapro_knowledge_lexical_search(text, int) TO authenticated;

DROP FUNCTION IF EXISTS public.regapro_knowledge_vector_search(vector(384), int);

CREATE FUNCTION public.regapro_knowledge_vector_search(
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
  vector_score double precision,
  is_current boolean,
  fact_status text,
  domain_keys text[]
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
      COALESCE(d.is_current, true) AS is_current,
      COALESCE(d.fact_status, 'fact') AS fact_status,
      COALESCE(d.domain_keys, ARRAY['company_common']::text[]) AS domain_keys,
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
      row_number() OVER (
        ORDER BY candidates.is_current DESC, candidates.vector_score DESC, candidates.chunk_id
      )::int AS vector_rank
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
    vector_score,
    is_current,
    fact_status,
    domain_keys
  FROM ranked
  WHERE vector_rank <= GREATEST(1, LEAST(COALESCE(p_limit, 40), 100));
$$;

REVOKE ALL ON FUNCTION public.regapro_knowledge_vector_search(vector, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.regapro_knowledge_vector_search(vector, int) TO authenticated;
