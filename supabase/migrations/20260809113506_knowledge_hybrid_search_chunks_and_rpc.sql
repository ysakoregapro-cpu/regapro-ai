-- =============================================================================
-- Knowledge Hybrid Search: chunk security denorm, pg_trgm lexical, pgvector RPC
-- Never edits applied migrations. Retrieval filters AccessContext BEFORE ranking.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- knowledge_documents: security fields for labeled access + publish metadata
-- ---------------------------------------------------------------------------

ALTER TABLE public.knowledge_documents
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id),
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id),
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

COMMENT ON COLUMN public.knowledge_documents.source_type IS
  'Origin kind: manual | import | conversation_insight | research | file | other. Private conversation raw must never be published as organization retrieval without review.';

-- ---------------------------------------------------------------------------
-- knowledge_chunks: searchable chunk model (inherits document security)
-- ---------------------------------------------------------------------------

ALTER TABLE public.knowledge_chunks
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id),
  ADD COLUMN IF NOT EXISTS document_id uuid REFERENCES public.knowledge_documents(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS content_normalized text,
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS confidentiality_level smallint
    CHECK (confidentiality_level IS NULL OR confidentiality_level IN (1, 2, 3)),
  ADD COLUMN IF NOT EXISTS visibility text
    CHECK (visibility IS NULL OR visibility IN (
      'private', 'participants', 'project', 'department', 'organization', 'restricted'
    )),
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id),
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id),
  ADD COLUMN IF NOT EXISTS origin_thread_id uuid REFERENCES public.chat_threads(id),
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS embedding_model text,
  ADD COLUMN IF NOT EXISTS embedding_version text,
  ADD COLUMN IF NOT EXISTS contains_personal_conversation boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Backfill denormalized security from parent document when possible
UPDATE public.knowledge_chunks c
SET
  org_id = d.org_id,
  document_id = d.id,
  content_normalized = COALESCE(c.content_normalized, c.content),
  content_hash = COALESCE(
    c.content_hash,
    encode(sha256(convert_to(c.content, 'UTF8')), 'hex')
  ),
  confidentiality_level = COALESCE(c.confidentiality_level, d.confidentiality_level),
  visibility = COALESCE(c.visibility, d.visibility),
  owner_user_id = COALESCE(c.owner_user_id, d.owner_user_id),
  department_id = COALESCE(c.department_id, d.department_id),
  project_id = COALESCE(c.project_id, d.project_id),
  origin_thread_id = COALESCE(c.origin_thread_id, d.origin_thread_id),
  source_type = COALESCE(c.source_type, d.source_type),
  contains_personal_conversation = COALESCE(
    c.contains_personal_conversation,
    d.contains_personal_conversation
  ),
  updated_at = now()
FROM public.knowledge_document_versions v
JOIN public.knowledge_documents d ON d.id = v.document_id
WHERE c.document_version_id = v.id
  AND (c.org_id IS NULL OR c.document_id IS NULL OR c.content_hash IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_chunks_version_index_uidx
  ON public.knowledge_chunks (document_version_id, chunk_index)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_chunks_version_hash_uidx
  ON public.knowledge_chunks (document_version_id, content_hash)
  WHERE deleted_at IS NULL AND content_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS knowledge_chunks_org_published_idx
  ON public.knowledge_chunks (org_id, document_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS knowledge_chunks_content_trgm_idx
  ON public.knowledge_chunks
  USING gin (content_normalized gin_trgm_ops)
  WHERE deleted_at IS NULL AND content_normalized IS NOT NULL;

CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_hnsw_idx
  ON public.knowledge_chunks
  USING hnsw (embedding vector_cosine_ops)
  WHERE deleted_at IS NULL AND embedding IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Policies: expand published SELECT via labeled_row; allow writers to manage chunks
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS knowledge_documents_select ON public.knowledge_documents;
CREATE POLICY knowledge_documents_select ON public.knowledge_documents
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      (
        status = 'published'
        AND COALESCE(contains_personal_conversation, false) = false
        AND public.regapro_can_access_labeled_row(
          org_id,
          confidentiality_level,
          visibility,
          owner_user_id,
          department_id,
          project_id,
          origin_thread_id
        )
      )
      OR (
        status <> 'published'
        AND (
          public.regapro_has_permission(org_id, 'knowledge:review')
          OR public.regapro_has_permission(org_id, 'knowledge:write')
        )
      )
    )
  );

DROP POLICY IF EXISTS knowledge_document_versions_select ON public.knowledge_document_versions;
CREATE POLICY knowledge_document_versions_select ON public.knowledge_document_versions
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.knowledge_documents d
      WHERE d.id = document_id
        AND d.deleted_at IS NULL
        AND (
          (
            d.status = 'published'
            AND COALESCE(d.contains_personal_conversation, false) = false
            AND public.regapro_can_access_labeled_row(
              d.org_id,
              d.confidentiality_level,
              d.visibility,
              d.owner_user_id,
              d.department_id,
              d.project_id,
              d.origin_thread_id
            )
          )
          OR (
            d.status <> 'published'
            AND (
              public.regapro_has_permission(d.org_id, 'knowledge:review')
              OR public.regapro_has_permission(d.org_id, 'knowledge:write')
            )
          )
        )
    )
  );

CREATE POLICY knowledge_document_versions_insert ON public.knowledge_document_versions
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.knowledge_documents d
      WHERE d.id = document_id
        AND d.deleted_at IS NULL
        AND public.regapro_has_permission(d.org_id, 'knowledge:write')
    )
  );

CREATE POLICY knowledge_document_versions_update ON public.knowledge_document_versions
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.knowledge_documents d
      WHERE d.id = document_id
        AND public.regapro_has_permission(d.org_id, 'knowledge:write')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.knowledge_documents d
      WHERE d.id = document_id
        AND public.regapro_has_permission(d.org_id, 'knowledge:write')
    )
  );

DROP POLICY IF EXISTS knowledge_chunks_select ON public.knowledge_chunks;
CREATE POLICY knowledge_chunks_select ON public.knowledge_chunks
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND org_id IS NOT NULL
    AND document_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.knowledge_documents d
      WHERE d.id = knowledge_chunks.document_id
        AND d.deleted_at IS NULL
        AND (
          (
            d.status = 'published'
            AND COALESCE(knowledge_chunks.contains_personal_conversation, false) = false
            AND COALESCE(d.contains_personal_conversation, false) = false
            AND public.regapro_can_access_labeled_row(
              knowledge_chunks.org_id,
              knowledge_chunks.confidentiality_level,
              knowledge_chunks.visibility,
              knowledge_chunks.owner_user_id,
              knowledge_chunks.department_id,
              knowledge_chunks.project_id,
              knowledge_chunks.origin_thread_id
            )
          )
          OR (
            d.status <> 'published'
            AND (
              public.regapro_has_permission(d.org_id, 'knowledge:review')
              OR public.regapro_has_permission(d.org_id, 'knowledge:write')
            )
          )
        )
    )
  );

CREATE POLICY knowledge_chunks_insert ON public.knowledge_chunks
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id IS NOT NULL
    AND document_id IS NOT NULL
    AND public.regapro_has_permission(org_id, 'knowledge:write')
    AND EXISTS (
      SELECT 1 FROM public.knowledge_documents d
      WHERE d.id = document_id
        AND d.org_id = org_id
        AND d.deleted_at IS NULL
    )
  );

CREATE POLICY knowledge_chunks_update ON public.knowledge_chunks
  FOR UPDATE TO authenticated
  USING (public.regapro_has_permission(org_id, 'knowledge:write'))
  WITH CHECK (public.regapro_has_permission(org_id, 'knowledge:write'));

CREATE POLICY knowledge_sources_insert ON public.knowledge_sources
  FOR INSERT TO authenticated
  WITH CHECK (public.regapro_has_permission(org_id, 'knowledge:write'));

CREATE POLICY knowledge_sources_update ON public.knowledge_sources
  FOR UPDATE TO authenticated
  USING (public.regapro_has_permission(org_id, 'knowledge:write'))
  WITH CHECK (public.regapro_has_permission(org_id, 'knowledge:write'));

CREATE POLICY knowledge_revisions_insert ON public.knowledge_revisions
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.knowledge_documents d
      WHERE d.id = document_id
        AND (
          public.regapro_has_permission(d.org_id, 'knowledge:write')
          OR public.regapro_has_permission(d.org_id, 'knowledge:review')
          OR public.regapro_has_permission(d.org_id, 'knowledge:approve')
        )
    )
  );

CREATE POLICY knowledge_approvals_insert ON public.knowledge_approvals
  FOR INSERT TO authenticated
  WITH CHECK (
    approver_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.knowledge_documents d
      WHERE d.id = document_id
        AND (
          public.regapro_has_permission(d.org_id, 'knowledge:approve')
          OR public.regapro_has_permission(d.org_id, 'knowledge:review')
        )
    )
  );

-- message_citations: writer + safe metadata (no unauthorized chunk body leak)
ALTER TABLE public.message_citations
  ADD COLUMN IF NOT EXISTS document_id uuid REFERENCES public.knowledge_documents(id),
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS excerpt text,
  ADD COLUMN IF NOT EXISTS relevance double precision;

CREATE POLICY message_citations_insert ON public.message_citations
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.chat_messages m
      JOIN public.chat_threads t ON t.id = m.thread_id
      WHERE m.id = message_id
        AND m.deleted_at IS NULL
        AND t.deleted_at IS NULL
        AND public.regapro_can_access_thread(t.id)
        AND (
          m.author_id = auth.uid()
          OR public.regapro_has_permission(t.org_id, 'chat:use')
        )
        AND (
          chunk_id IS NULL
          OR EXISTS (
            SELECT 1 FROM public.knowledge_chunks c
            WHERE c.id = chunk_id
              AND c.deleted_at IS NULL
          )
        )
    )
  );

-- ---------------------------------------------------------------------------
-- Shared predicate: published knowledge eligible for normal AI retrieval
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.regapro_knowledge_chunk_retrievable(p_chunk_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.knowledge_chunks c
    JOIN public.knowledge_documents d ON d.id = c.document_id
    WHERE c.id = p_chunk_id
      AND c.deleted_at IS NULL
      AND d.deleted_at IS NULL
      AND c.org_id IS NOT NULL
      AND c.document_id IS NOT NULL
      AND d.status = 'published'
      AND COALESCE(c.contains_personal_conversation, false) = false
      AND COALESCE(d.contains_personal_conversation, false) = false
      AND public.regapro_can_access_labeled_row(
        c.org_id,
        c.confidentiality_level,
        c.visibility,
        c.owner_user_id,
        c.department_id,
        c.project_id,
        c.origin_thread_id
      )
  );
$$;

REVOKE ALL ON FUNCTION public.regapro_knowledge_chunk_retrievable(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.regapro_knowledge_chunk_retrievable(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Lexical search (pg_trgm) — Japanese-capable substring / word similarity
-- Security pre-filter in WHERE before ordering. SECURITY INVOKER (user JWT).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.regapro_knowledge_lexical_search(
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
  lexical_score double precision
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
      row_number() OVER (ORDER BY candidates.lexical_score DESC, candidates.chunk_id)::int AS lexical_rank
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
    lexical_score
  FROM ranked
  WHERE lexical_rank <= GREATEST(1, LEAST(COALESCE(p_limit, 40), 100));
$$;

REVOKE ALL ON FUNCTION public.regapro_knowledge_lexical_search(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.regapro_knowledge_lexical_search(text, int) TO authenticated;

-- ---------------------------------------------------------------------------
-- Vector search — candidates must already pass security predicate
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.regapro_knowledge_vector_search(
  p_query_embedding vector(1536),
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

COMMENT ON FUNCTION public.regapro_knowledge_lexical_search(text, int) IS
  'Trigram / word similarity lexical retrieval over published knowledge_chunks. Filters with AccessContext (JWT) before ranking. Never uses service_role.';

COMMENT ON FUNCTION public.regapro_knowledge_vector_search(vector, int) IS
  'pgvector cosine retrieval over published knowledge_chunks with embeddings. Security pre-filter before distance ranking. Empty when embeddings absent.';
