-- Knowledge Factory: extend existing knowledge_* tables and add job/source-chunk/review
-- layers. Does not rewrite published retrieval RPCs. Existing migrations untouched.

-- ---------------------------------------------------------------------------
-- Catalog (data-driven domains)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.knowledge_domain_catalog (
  key text PRIMARY KEY,
  label text NOT NULL,
  org_id uuid REFERENCES public.organizations(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.knowledge_domain_catalog (key, label, org_id) VALUES
  ('company_common', '全社共通', NULL),
  ('sales', '営業', NULL),
  ('telecom', '通信', NULL),
  ('recruitment', '有料職業紹介', NULL),
  ('real_estate', '不動産', NULL),
  ('staffing', '人材', NULL),
  ('engineering', 'エンジニアリング', NULL),
  ('management', '経営', NULL)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.knowledge_domain_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY knowledge_domain_catalog_select ON public.knowledge_domain_catalog
  FOR SELECT TO authenticated
  USING (org_id IS NULL OR public.regapro_is_org_member(org_id));

CREATE POLICY knowledge_domain_catalog_insert ON public.knowledge_domain_catalog
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id IS NOT NULL
    AND public.regapro_has_permission(org_id, 'knowledge:write')
  );

-- ---------------------------------------------------------------------------
-- knowledge_sources — keep original text / file / URL provenance
-- ---------------------------------------------------------------------------
ALTER TABLE public.knowledge_sources
  ADD COLUMN IF NOT EXISTS origin_kind text NOT NULL DEFAULT 'manual'
    CHECK (origin_kind IN ('paste','qa','file','url','research','conversation','transcript','api','manual')),
  ADD COLUMN IF NOT EXISTS raw_text text,
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS file_object_id uuid REFERENCES public.file_objects(id),
  ADD COLUMN IF NOT EXISTS origin_url text,
  ADD COLUMN IF NOT EXISTS canonical_url text,
  ADD COLUMN IF NOT EXISTS domain text,
  ADD COLUMN IF NOT EXISTS confidentiality_level smallint NOT NULL DEFAULT 1
    CHECK (confidentiality_level IN (1, 2, 3)),
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'organization'
    CHECK (visibility IN ('private','participants','project','department','organization','restricted')),
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id),
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id),
  ADD COLUMN IF NOT EXISTS origin_thread_id uuid REFERENCES public.chat_threads(id),
  ADD COLUMN IF NOT EXISTS origin_message_id uuid,
  ADD COLUMN IF NOT EXISTS source_date date,
  ADD COLUMN IF NOT EXISTS observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS retrieved_at timestamptz,
  ADD COLUMN IF NOT EXISTS published_at_external timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS contains_personal_conversation boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS contains_personal_data boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS contains_compensation_data boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_sources_org_hash_active
  ON public.knowledge_sources (org_id, content_hash)
  WHERE deleted_at IS NULL AND content_hash IS NOT NULL;

DROP POLICY IF EXISTS knowledge_sources_select ON public.knowledge_sources;
CREATE POLICY knowledge_sources_select ON public.knowledge_sources
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.regapro_is_org_member(org_id)
    AND public.regapro_can_access_labeled_row(
      org_id,
      confidentiality_level,
      visibility,
      owner_user_id,
      department_id,
      project_id,
      origin_thread_id
    )
    AND (
      public.regapro_has_permission(org_id, 'knowledge:write')
      OR public.regapro_has_permission(org_id, 'knowledge:review')
      OR owner_user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Ingestion jobs (resumable). Swap runner later; table is the port.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.knowledge_ingestion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  source_id uuid NOT NULL REFERENCES public.knowledge_sources(id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','completed','failed','cancelled')),
  total_units int NOT NULL DEFAULT 0,
  processed_units int NOT NULL DEFAULT 0,
  failed_units int NOT NULL DEFAULT 0,
  cursor_index int NOT NULL DEFAULT 0,
  error_summary text,
  budget jsonb NOT NULL DEFAULT '{}'::jsonb,
  model_calls int NOT NULL DEFAULT 0,
  estimated_tokens int NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS knowledge_ingestion_jobs_source_idx
  ON public.knowledge_ingestion_jobs (source_id)
  WHERE deleted_at IS NULL;

ALTER TABLE public.knowledge_ingestion_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY knowledge_ingestion_jobs_select ON public.knowledge_ingestion_jobs
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.regapro_is_org_member(org_id)
    AND (
      created_by = auth.uid()
      OR public.regapro_has_permission(org_id, 'knowledge:write')
      OR public.regapro_has_permission(org_id, 'knowledge:review')
    )
  );

CREATE POLICY knowledge_ingestion_jobs_insert ON public.knowledge_ingestion_jobs
  FOR INSERT TO authenticated
  WITH CHECK (
    public.regapro_has_permission(org_id, 'knowledge:write')
    AND created_by = auth.uid()
  );

CREATE POLICY knowledge_ingestion_jobs_update ON public.knowledge_ingestion_jobs
  FOR UPDATE TO authenticated
  USING (public.regapro_has_permission(org_id, 'knowledge:write'))
  WITH CHECK (public.regapro_has_permission(org_id, 'knowledge:write'));

-- ---------------------------------------------------------------------------
-- Deterministic source chunks (not org retrieval)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.knowledge_source_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  source_id uuid NOT NULL REFERENCES public.knowledge_sources(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.knowledge_ingestion_jobs(id),
  chunk_index int NOT NULL,
  content text NOT NULL,
  content_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','completed','failed')),
  error_code text,
  extracted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_source_chunks_hash_active
  ON public.knowledge_source_chunks (source_id, content_hash)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_source_chunks_index_active
  ON public.knowledge_source_chunks (source_id, chunk_index)
  WHERE deleted_at IS NULL;

ALTER TABLE public.knowledge_source_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY knowledge_source_chunks_select ON public.knowledge_source_chunks
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.knowledge_sources s
      WHERE s.id = source_id AND s.deleted_at IS NULL
        AND public.regapro_is_org_member(s.org_id)
        AND (
          public.regapro_has_permission(s.org_id, 'knowledge:write')
          OR public.regapro_has_permission(s.org_id, 'knowledge:review')
          OR s.owner_user_id = auth.uid()
        )
    )
  );

CREATE POLICY knowledge_source_chunks_write ON public.knowledge_source_chunks
  FOR INSERT TO authenticated
  WITH CHECK (public.regapro_has_permission(org_id, 'knowledge:write'));

CREATE POLICY knowledge_source_chunks_update ON public.knowledge_source_chunks
  FOR UPDATE TO authenticated
  USING (public.regapro_has_permission(org_id, 'knowledge:write'))
  WITH CHECK (public.regapro_has_permission(org_id, 'knowledge:write'));

-- ---------------------------------------------------------------------------
-- Candidates — evidence + review classification
-- ---------------------------------------------------------------------------
ALTER TABLE public.knowledge_candidates
  ADD COLUMN IF NOT EXISTS source_id uuid REFERENCES public.knowledge_sources(id),
  ADD COLUMN IF NOT EXISTS source_chunk_id uuid REFERENCES public.knowledge_source_chunks(id),
  ADD COLUMN IF NOT EXISTS source_excerpt text,
  ADD COLUMN IF NOT EXISTS candidate_type text NOT NULL DEFAULT 'knowhow'
    CHECK (candidate_type IN (
      'fact','policy','procedure','decision','strategy','knowhow','qa',
      'definition','organization','historical_event'
    )),
  ADD COLUMN IF NOT EXISTS fact_status text NOT NULL DEFAULT 'proposal'
    CHECK (fact_status IN ('fact','decision','proposal','hypothesis','rejected','historical')),
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'new'
    CHECK (review_status IN ('new','duplicate','conflict','possible_update','approved','rejected')),
  ADD COLUMN IF NOT EXISTS domain_keys text[] NOT NULL DEFAULT ARRAY['company_common']::text[],
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS applicability text,
  ADD COLUMN IF NOT EXISTS exceptions text,
  ADD COLUMN IF NOT EXISTS paraphrases text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS valid_from date,
  ADD COLUMN IF NOT EXISTS valid_until date,
  ADD COLUMN IF NOT EXISTS observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_date date,
  ADD COLUMN IF NOT EXISTS supersedes_document_id uuid REFERENCES public.knowledge_documents(id),
  ADD COLUMN IF NOT EXISTS conflict_kind text NOT NULL DEFAULT 'new'
    CHECK (conflict_kind IN ('new','duplicate','supersession','conflict')),
  ADD COLUMN IF NOT EXISTS confidence numeric(4,3),
  ADD COLUMN IF NOT EXISTS source_quality numeric(4,3),
  ADD COLUMN IF NOT EXISTS published_document_id uuid REFERENCES public.knowledge_documents(id),
  ADD COLUMN IF NOT EXISTS extracted_at timestamptz;

CREATE INDEX IF NOT EXISTS knowledge_candidates_review_idx
  ON public.knowledge_candidates (org_id, review_status)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Candidate reviews (distinct from document knowledge_approvals)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.knowledge_candidate_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  candidate_id uuid NOT NULL REFERENCES public.knowledge_candidates(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES auth.users(id),
  action text NOT NULL
    CHECK (action IN ('approve','edit_approve','reject','merge','mark_duplicate','supersede')),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.knowledge_candidate_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY knowledge_candidate_reviews_select ON public.knowledge_candidate_reviews
  FOR SELECT TO authenticated
  USING (
    public.regapro_is_org_member(org_id)
    AND (
      reviewer_id = auth.uid()
      OR public.regapro_has_permission(org_id, 'knowledge:review')
      OR public.regapro_has_permission(org_id, 'knowledge:approve')
    )
  );

CREATE POLICY knowledge_candidate_reviews_insert ON public.knowledge_candidate_reviews
  FOR INSERT TO authenticated
  WITH CHECK (
    reviewer_id = auth.uid()
    AND (
      public.regapro_has_permission(org_id, 'knowledge:review')
      OR public.regapro_has_permission(org_id, 'knowledge:approve')
      OR public.regapro_has_permission(org_id, 'knowledge:write')
    )
  );

-- ---------------------------------------------------------------------------
-- Documents — freshness / supersession / embedding status
-- ---------------------------------------------------------------------------
ALTER TABLE public.knowledge_documents
  ADD COLUMN IF NOT EXISTS candidate_id uuid REFERENCES public.knowledge_candidates(id),
  ADD COLUMN IF NOT EXISTS domain_keys text[] NOT NULL DEFAULT ARRAY['company_common']::text[],
  ADD COLUMN IF NOT EXISTS fact_status text NOT NULL DEFAULT 'fact'
    CHECK (fact_status IN ('fact','decision','proposal','hypothesis','rejected','historical')),
  ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS valid_from date,
  ADD COLUMN IF NOT EXISTS valid_until date,
  ADD COLUMN IF NOT EXISTS observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_date date,
  ADD COLUMN IF NOT EXISTS supersedes_id uuid REFERENCES public.knowledge_documents(id),
  ADD COLUMN IF NOT EXISTS superseded_by_id uuid REFERENCES public.knowledge_documents(id),
  ADD COLUMN IF NOT EXISTS source_quality numeric(4,3),
  ADD COLUMN IF NOT EXISTS embedding_status text NOT NULL DEFAULT 'pending'
    CHECK (embedding_status IN ('pending','ready','failed','skipped'));

CREATE TABLE IF NOT EXISTS public.knowledge_document_domains (
  document_id uuid NOT NULL REFERENCES public.knowledge_documents(id) ON DELETE CASCADE,
  domain_key text NOT NULL REFERENCES public.knowledge_domain_catalog(key),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  PRIMARY KEY (document_id, domain_key)
);

ALTER TABLE public.knowledge_document_domains ENABLE ROW LEVEL SECURITY;

CREATE POLICY knowledge_document_domains_select ON public.knowledge_document_domains
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.knowledge_documents d
      WHERE d.id = document_id AND d.deleted_at IS NULL
        AND public.regapro_is_org_member(d.org_id)
    )
  );

CREATE POLICY knowledge_document_domains_write ON public.knowledge_document_domains
  FOR INSERT TO authenticated
  WITH CHECK (public.regapro_has_permission(org_id, 'knowledge:write'));

-- ---------------------------------------------------------------------------
-- Facts — evidence link (table already existed, unused by app)
-- ---------------------------------------------------------------------------
ALTER TABLE public.knowledge_facts
  ADD COLUMN IF NOT EXISTS candidate_id uuid REFERENCES public.knowledge_candidates(id),
  ADD COLUMN IF NOT EXISTS source_id uuid REFERENCES public.knowledge_sources(id),
  ADD COLUMN IF NOT EXISTS source_chunk_id uuid REFERENCES public.knowledge_source_chunks(id),
  ADD COLUMN IF NOT EXISTS fact_type text,
  ADD COLUMN IF NOT EXISTS fact_status text,
  ADD COLUMN IF NOT EXISTS excerpt text,
  ADD COLUMN IF NOT EXISTS valid_from date,
  ADD COLUMN IF NOT EXISTS valid_until date,
  ADD COLUMN IF NOT EXISTS observed_at timestamptz;

-- ---------------------------------------------------------------------------
-- Training candidates — NOT mixed into knowledge retrieval
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.knowledge_training_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  question text NOT NULL,
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  model_answer text,
  corrected_answer text,
  evaluation text,
  confidentiality_level smallint NOT NULL DEFAULT 1 CHECK (confidentiality_level IN (1,2,3)),
  visibility text NOT NULL DEFAULT 'organization',
  origin_thread_id uuid REFERENCES public.chat_threads(id),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

ALTER TABLE public.knowledge_training_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY knowledge_training_candidates_select ON public.knowledge_training_candidates
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.regapro_is_org_member(org_id)
    AND public.regapro_can_access_confidentiality_level(org_id, confidentiality_level)
    AND (
      created_by = auth.uid()
      OR public.regapro_has_permission(org_id, 'knowledge:review')
    )
  );

CREATE POLICY knowledge_training_candidates_insert ON public.knowledge_training_candidates
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.regapro_is_org_member(org_id)
    AND public.regapro_can_assign_confidentiality_level(org_id, confidentiality_level)
  );

COMMENT ON TABLE public.knowledge_ingestion_jobs IS
  'Resumable Knowledge Factory jobs. error_summary must not contain raw private text.';
COMMENT ON TABLE public.knowledge_source_chunks IS
  'Deterministic source splits. Excluded from org retrieval RPCs.';
COMMENT ON TABLE public.knowledge_training_candidates IS
  'Future training dataset. Never mixed into Internal Knowledge retrieval.';
COMMENT ON COLUMN public.knowledge_documents.is_current IS
  'Current vs historical. New facts supersede by linking, never physical delete.';
