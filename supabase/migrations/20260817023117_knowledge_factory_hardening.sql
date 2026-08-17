-- Knowledge Factory production hardening.
-- Does not edit prior migrations. Aligns durable jobs, extraction cache,
-- source storage, extractor provenance, and current-knowledge ranking.

-- ---------------------------------------------------------------------------
-- Origin kind: authoritative current-company seed (still requires human review)
-- ---------------------------------------------------------------------------
ALTER TABLE public.knowledge_sources
  DROP CONSTRAINT IF EXISTS knowledge_sources_origin_kind_check;

ALTER TABLE public.knowledge_sources
  ADD CONSTRAINT knowledge_sources_origin_kind_check
  CHECK (origin_kind IN (
    'paste','qa','file','url','research','conversation','transcript',
    'api','manual','authoritative_seed'
  ));

ALTER TABLE public.knowledge_sources
  ADD COLUMN IF NOT EXISTS storage_path text,
  ADD COLUMN IF NOT EXISTS original_filename text,
  ADD COLUMN IF NOT EXISTS mime_type text,
  ADD COLUMN IF NOT EXISTS size_bytes bigint,
  ADD COLUMN IF NOT EXISTS checksum text,
  ADD COLUMN IF NOT EXISTS normalized_text text,
  ADD COLUMN IF NOT EXISTS requires_ocr boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.knowledge_sources.storage_path IS
  'Private knowledge-sources object path. Never store long-lived signed URLs.';
COMMENT ON COLUMN public.knowledge_sources.normalized_text IS
  'Extracted text for chunking. Small paste/Q&A may live only in raw_text.';
COMMENT ON COLUMN public.knowledge_sources.requires_ocr IS
  'Scan PDF or empty extract. Do not treat empty text as successful ingestion.';

-- ---------------------------------------------------------------------------
-- Durable job lease / pause / cancel (Postgres queue; pgmq not installed)
-- ---------------------------------------------------------------------------
ALTER TABLE public.knowledge_ingestion_jobs
  DROP CONSTRAINT IF EXISTS knowledge_ingestion_jobs_status_check;

ALTER TABLE public.knowledge_ingestion_jobs
  ADD CONSTRAINT knowledge_ingestion_jobs_status_check
  CHECK (status IN (
    'pending','processing','completed','failed','cancelled','paused'
  ));

ALTER TABLE public.knowledge_ingestion_jobs
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS lease_owner text,
  ADD COLUMN IF NOT EXISTS attempt_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error_code text,
  ADD COLUMN IF NOT EXISTS paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_requested boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS estimated_cost_usd numeric(12,6);

CREATE INDEX IF NOT EXISTS knowledge_ingestion_jobs_lease_idx
  ON public.knowledge_ingestion_jobs (status, next_attempt_at, lease_expires_at)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Source chunk lease / retry / waiting_for_extractor
-- ---------------------------------------------------------------------------
ALTER TABLE public.knowledge_source_chunks
  DROP CONSTRAINT IF EXISTS knowledge_source_chunks_status_check;

ALTER TABLE public.knowledge_source_chunks
  ADD CONSTRAINT knowledge_source_chunks_status_check
  CHECK (status IN (
    'pending','processing','completed','failed','retryable','waiting_for_extractor'
  ));

ALTER TABLE public.knowledge_source_chunks
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempt_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error_code text;

CREATE INDEX IF NOT EXISTS knowledge_source_chunks_claim_idx
  ON public.knowledge_source_chunks (job_id, status, chunk_index)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Candidate extractor provenance + idempotent insert
-- ---------------------------------------------------------------------------
ALTER TABLE public.knowledge_candidates
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS extractor_type text,
  ADD COLUMN IF NOT EXISTS extractor_version text,
  ADD COLUMN IF NOT EXISTS model_role text,
  ADD COLUMN IF NOT EXISTS model_id text,
  ADD COLUMN IF NOT EXISTS prompt_version text,
  ADD COLUMN IF NOT EXISTS conflict_reason text,
  ADD COLUMN IF NOT EXISTS is_current boolean;

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_candidates_chunk_hash_active
  ON public.knowledge_candidates (source_chunk_id, content_hash)
  WHERE deleted_at IS NULL
    AND source_chunk_id IS NOT NULL
    AND content_hash IS NOT NULL;

COMMENT ON COLUMN public.knowledge_candidates.extractor_version IS
  'heuristic-v1 / llm-extractor-v1 / … Admin diagnostics only; not general UI.';

-- ---------------------------------------------------------------------------
-- Extraction result cache (chunk hash + extractor/model/prompt versions)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.knowledge_extraction_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  source_chunk_hash text NOT NULL,
  extractor_type text NOT NULL,
  extractor_version text NOT NULL,
  model_id text NOT NULL DEFAULT '',
  prompt_version text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_extraction_cache_key
  ON public.knowledge_extraction_cache (
    org_id, source_chunk_hash, extractor_type, extractor_version, model_id, prompt_version
  );

ALTER TABLE public.knowledge_extraction_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY knowledge_extraction_cache_select ON public.knowledge_extraction_cache
  FOR SELECT TO authenticated
  USING (
    public.regapro_is_org_member(org_id)
    AND (
      public.regapro_has_permission(org_id, 'knowledge:write')
      OR public.regapro_has_permission(org_id, 'knowledge:review')
    )
  );

CREATE POLICY knowledge_extraction_cache_write ON public.knowledge_extraction_cache
  FOR INSERT TO authenticated
  WITH CHECK (public.regapro_has_permission(org_id, 'knowledge:write'));

GRANT SELECT, INSERT ON TABLE public.knowledge_extraction_cache TO authenticated;
GRANT ALL ON TABLE public.knowledge_extraction_cache TO service_role;

COMMENT ON TABLE public.knowledge_extraction_cache IS
  'LLM extraction cache. result must not include secrets. Re-extract only when extractor/model/prompt version changes.';

-- ---------------------------------------------------------------------------
-- Atomic chunk claim (SKIP LOCKED). Application still owns poison/retry policy.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.regapro_claim_knowledge_source_chunks(
  p_job_id uuid,
  p_limit int,
  p_lease_seconds int,
  p_include_waiting boolean DEFAULT false
)
RETURNS SETOF public.knowledge_source_chunks
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT c.id
    FROM public.knowledge_source_chunks c
    WHERE c.job_id = p_job_id
      AND c.deleted_at IS NULL
      AND (
        c.status IN ('pending', 'retryable')
        OR (p_include_waiting AND c.status = 'waiting_for_extractor')
        OR (
          c.status = 'processing'
          AND c.lease_expires_at IS NOT NULL
          AND c.lease_expires_at < now()
        )
      )
      AND (c.next_attempt_at IS NULL OR c.next_attempt_at <= now())
    ORDER BY c.chunk_index
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 4), 32))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.knowledge_source_chunks c
  SET
    status = 'processing',
    lease_expires_at = now() + make_interval(secs => GREATEST(15, LEAST(COALESCE(p_lease_seconds, 90), 600))),
    attempt_count = c.attempt_count + 1,
    last_error_code = NULL,
    updated_at = now()
  FROM picked
  WHERE c.id = picked.id
  RETURNING c.*;
END;
$$;

REVOKE ALL ON FUNCTION public.regapro_claim_knowledge_source_chunks(uuid, int, int, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.regapro_claim_knowledge_source_chunks(uuid, int, int, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.regapro_claim_knowledge_ingestion_job(
  p_job_id uuid,
  p_lease_seconds int,
  p_owner text
)
RETURNS public.knowledge_ingestion_jobs
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  claimed public.knowledge_ingestion_jobs;
BEGIN
  UPDATE public.knowledge_ingestion_jobs j
  SET
    status = CASE WHEN j.cancel_requested THEN 'cancelled' ELSE 'processing' END,
    lease_expires_at = now() + make_interval(secs => GREATEST(15, LEAST(COALESCE(p_lease_seconds, 90), 600))),
    lease_owner = p_owner,
    attempt_count = j.attempt_count + 1,
    started_at = COALESCE(j.started_at, now()),
    paused_at = NULL,
    updated_at = now()
  WHERE j.id = p_job_id
    AND j.deleted_at IS NULL
    AND j.paused_at IS NULL
    AND j.status IN ('pending', 'processing', 'paused')
    AND (
      j.lease_expires_at IS NULL
      OR j.lease_expires_at < now()
      OR j.lease_owner = p_owner
    )
    AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= now())
  RETURNING * INTO claimed;

  RETURN claimed;
END;
$$;

REVOKE ALL ON FUNCTION public.regapro_claim_knowledge_ingestion_job(uuid, int, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.regapro_claim_knowledge_ingestion_job(uuid, int, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Private original-file bucket. Access via file_objects + labeled-row RLS.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('knowledge-sources', 'knowledge-sources', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS storage_org_select ON storage.objects;
CREATE POLICY storage_org_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id IN (
      'knowledge-files', 'chat-attachments', 'artifacts',
      'research-snapshots', 'knowledge-sources'
    )
    AND public.regapro_can_access_storage_object(bucket_id, name)
  );

DROP POLICY IF EXISTS storage_org_insert ON storage.objects;
CREATE POLICY storage_org_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id IN (
      'knowledge-files', 'chat-attachments', 'artifacts',
      'research-snapshots', 'knowledge-sources'
    )
    AND name LIKE 'org/%'
    AND public.regapro_is_org_member((split_part(name, '/', 2))::uuid)
  );

DROP POLICY IF EXISTS storage_org_update ON storage.objects;
CREATE POLICY storage_org_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id IN (
      'knowledge-files', 'chat-attachments', 'artifacts',
      'research-snapshots', 'knowledge-sources'
    )
    AND public.regapro_can_access_storage_object(bucket_id, name)
  )
  WITH CHECK (
    bucket_id IN (
      'knowledge-files', 'chat-attachments', 'artifacts',
      'research-snapshots', 'knowledge-sources'
    )
    AND public.regapro_can_access_storage_object(bucket_id, name)
  );

DROP POLICY IF EXISTS storage_org_delete ON storage.objects;
CREATE POLICY storage_org_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id IN (
      'knowledge-files', 'chat-attachments', 'artifacts',
      'research-snapshots', 'knowledge-sources'
    )
    AND public.regapro_can_access_storage_object(bucket_id, name)
  );

DROP POLICY IF EXISTS storage_org_delete_orphan ON storage.objects;
CREATE POLICY storage_org_delete_orphan ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id IN (
      'knowledge-files', 'chat-attachments', 'artifacts',
      'research-snapshots', 'knowledge-sources'
    )
    AND name LIKE 'org/%'
    AND owner = auth.uid()
    AND NOT EXISTS (
      SELECT 1
      FROM public.file_objects fo
      WHERE fo.bucket = bucket_id
        AND fo.path = name
        AND fo.deleted_at IS NULL
    )
  );

-- ---------------------------------------------------------------------------
-- Retrieval: prefer current + higher source_quality (authoritative seed)
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
      COALESCE(d.source_quality, 0)::double precision AS source_quality,
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
        ORDER BY
          candidates.is_current DESC,
          candidates.source_quality DESC,
          candidates.lexical_score DESC,
          candidates.chunk_id
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
      COALESCE(d.source_quality, 0)::double precision AS source_quality,
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
        ORDER BY
          candidates.is_current DESC,
          candidates.source_quality DESC,
          candidates.vector_score DESC,
          candidates.chunk_id
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
