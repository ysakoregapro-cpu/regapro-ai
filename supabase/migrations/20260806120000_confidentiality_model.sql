-- Confidentiality model, conversation privacy, clearance overrides
-- Local / review only — do not apply to remote without human confirmation.

-- ---------------------------------------------------------------------------
-- Departments: key + default clearance
-- ---------------------------------------------------------------------------

ALTER TABLE public.departments
  ADD COLUMN IF NOT EXISTS key text,
  ADD COLUMN IF NOT EXISTS default_clearance_level smallint NOT NULL DEFAULT 1
    CHECK (default_clearance_level IN (1, 2, 3));

CREATE UNIQUE INDEX IF NOT EXISTS idx_departments_org_key
  ON public.departments(org_id, key)
  WHERE key IS NOT NULL AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Membership clearance override (admin-managed only)
-- ---------------------------------------------------------------------------

ALTER TABLE public.organization_memberships
  ADD COLUMN IF NOT EXISTS clearance_override smallint
    CHECK (clearance_override IS NULL OR clearance_override IN (1, 2, 3)),
  ADD COLUMN IF NOT EXISTS clearance_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS clearance_updated_by uuid REFERENCES auth.users(id);

-- ---------------------------------------------------------------------------
-- Visibility: migrate projects.team → participants + extend CHECK
-- ---------------------------------------------------------------------------

UPDATE public.projects
SET visibility = 'participants'
WHERE visibility = 'team';

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_visibility_check;

ALTER TABLE public.projects
  ADD CONSTRAINT projects_visibility_check
  CHECK (visibility IN (
    'private', 'participants', 'project', 'department', 'organization', 'restricted'
  ));

-- ---------------------------------------------------------------------------
-- Chat threads / messages security columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.chat_threads
  ADD COLUMN IF NOT EXISTS confidentiality_level smallint NOT NULL DEFAULT 1
    CHECK (confidentiality_level IN (1, 2, 3)),
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private'
    CHECK (visibility IN (
      'private', 'participants', 'project', 'department', 'organization', 'restricted'
    )),
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id),
  ADD COLUMN IF NOT EXISTS security_label_source text NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS minimum_derived_level smallint NOT NULL DEFAULT 1
    CHECK (minimum_derived_level IN (1, 2, 3)),
  ADD COLUMN IF NOT EXISTS contains_sensitive_content boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS classification_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS classification_reviewed_by uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_chat_threads_owner
  ON public.chat_threads(owner_user_id)
  WHERE deleted_at IS NULL;

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS confidentiality_level smallint NOT NULL DEFAULT 1
    CHECK (confidentiality_level IN (1, 2, 3)),
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private'
    CHECK (visibility IN (
      'private', 'participants', 'project', 'department', 'organization', 'restricted'
    )),
  ADD COLUMN IF NOT EXISTS source_message_id uuid REFERENCES public.chat_messages(id),
  ADD COLUMN IF NOT EXISTS sensitivity_signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS classification_confidence numeric(4,3),
  ADD COLUMN IF NOT EXISTS classification_source text;

-- ---------------------------------------------------------------------------
-- Derived resources: security label inheritance columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS confidentiality_level smallint NOT NULL DEFAULT 1
    CHECK (confidentiality_level IN (1, 2, 3)),
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private'
    CHECK (visibility IN (
      'private', 'participants', 'project', 'department', 'organization', 'restricted'
    )),
  ADD COLUMN IF NOT EXISTS origin_thread_id uuid REFERENCES public.chat_threads(id),
  ADD COLUMN IF NOT EXISTS origin_message_id uuid REFERENCES public.chat_messages(id),
  ADD COLUMN IF NOT EXISTS security_label_source text NOT NULL DEFAULT 'inherited',
  ADD COLUMN IF NOT EXISTS minimum_derived_level smallint NOT NULL DEFAULT 1
    CHECK (minimum_derived_level IN (1, 2, 3));

ALTER TABLE public.artifacts
  ADD COLUMN IF NOT EXISTS confidentiality_level smallint NOT NULL DEFAULT 1
    CHECK (confidentiality_level IN (1, 2, 3)),
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private'
    CHECK (visibility IN (
      'private', 'participants', 'project', 'department', 'organization', 'restricted'
    )),
  ADD COLUMN IF NOT EXISTS origin_thread_id uuid REFERENCES public.chat_threads(id),
  ADD COLUMN IF NOT EXISTS origin_message_id uuid REFERENCES public.chat_messages(id),
  ADD COLUMN IF NOT EXISTS security_label_source text NOT NULL DEFAULT 'inherited',
  ADD COLUMN IF NOT EXISTS minimum_derived_level smallint NOT NULL DEFAULT 1
    CHECK (minimum_derived_level IN (1, 2, 3));

ALTER TABLE public.research_runs
  ADD COLUMN IF NOT EXISTS confidentiality_level smallint NOT NULL DEFAULT 1
    CHECK (confidentiality_level IN (1, 2, 3)),
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private'
    CHECK (visibility IN (
      'private', 'participants', 'project', 'department', 'organization', 'restricted'
    )),
  ADD COLUMN IF NOT EXISTS origin_thread_id uuid REFERENCES public.chat_threads(id),
  ADD COLUMN IF NOT EXISTS origin_message_id uuid REFERENCES public.chat_messages(id),
  ADD COLUMN IF NOT EXISTS security_label_source text NOT NULL DEFAULT 'inherited';

ALTER TABLE public.research_findings
  ADD COLUMN IF NOT EXISTS confidentiality_level smallint NOT NULL DEFAULT 1
    CHECK (confidentiality_level IN (1, 2, 3)),
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private'
    CHECK (visibility IN (
      'private', 'participants', 'project', 'department', 'organization', 'restricted'
    )),
  ADD COLUMN IF NOT EXISTS origin_thread_id uuid REFERENCES public.chat_threads(id),
  ADD COLUMN IF NOT EXISTS origin_message_id uuid REFERENCES public.chat_messages(id);

ALTER TABLE public.generated_prompts
  ADD COLUMN IF NOT EXISTS confidentiality_level smallint NOT NULL DEFAULT 1
    CHECK (confidentiality_level IN (1, 2, 3)),
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private'
    CHECK (visibility IN (
      'private', 'participants', 'project', 'department', 'organization', 'restricted'
    )),
  ADD COLUMN IF NOT EXISTS origin_thread_id uuid REFERENCES public.chat_threads(id),
  ADD COLUMN IF NOT EXISTS origin_message_id uuid REFERENCES public.chat_messages(id);

ALTER TABLE public.file_objects
  ADD COLUMN IF NOT EXISTS confidentiality_level smallint NOT NULL DEFAULT 1
    CHECK (confidentiality_level IN (1, 2, 3)),
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private'
    CHECK (visibility IN (
      'private', 'participants', 'project', 'department', 'organization', 'restricted'
    )),
  ADD COLUMN IF NOT EXISTS origin_thread_id uuid REFERENCES public.chat_threads(id),
  ADD COLUMN IF NOT EXISTS origin_message_id uuid REFERENCES public.chat_messages(id);

ALTER TABLE public.memory_items
  ADD COLUMN IF NOT EXISTS confidentiality_level smallint NOT NULL DEFAULT 1
    CHECK (confidentiality_level IN (1, 2, 3)),
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private'
    CHECK (visibility IN (
      'private', 'participants', 'project', 'department', 'organization', 'restricted'
    )),
  ADD COLUMN IF NOT EXISTS origin_thread_id uuid REFERENCES public.chat_threads(id);

ALTER TABLE public.knowledge_documents
  ADD COLUMN IF NOT EXISTS confidentiality_level smallint NOT NULL DEFAULT 1
    CHECK (confidentiality_level IN (1, 2, 3)),
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'organization'
    CHECK (visibility IN (
      'private', 'participants', 'project', 'department', 'organization', 'restricted'
    )),
  ADD COLUMN IF NOT EXISTS origin_thread_id uuid REFERENCES public.chat_threads(id),
  ADD COLUMN IF NOT EXISTS contains_personal_conversation boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS contains_personal_data boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS contains_compensation_data boolean NOT NULL DEFAULT false;

ALTER TABLE public.tool_executions
  ADD COLUMN IF NOT EXISTS confidentiality_level smallint NOT NULL DEFAULT 1
    CHECK (confidentiality_level IN (1, 2, 3)),
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private'
    CHECK (visibility IN (
      'private', 'participants', 'project', 'department', 'organization', 'restricted'
    )),
  ADD COLUMN IF NOT EXISTS origin_thread_id uuid REFERENCES public.chat_threads(id);

-- Knowledge candidates (if table missing, create thin candidate store)
CREATE TABLE IF NOT EXISTS public.knowledge_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  title text NOT NULL,
  content text NOT NULL,
  suggested_confidentiality_level smallint NOT NULL DEFAULT 1
    CHECK (suggested_confidentiality_level IN (1, 2, 3)),
  confirmed_confidentiality_level smallint
    CHECK (confirmed_confidentiality_level IS NULL OR confirmed_confidentiality_level IN (1, 2, 3)),
  suggested_visibility text NOT NULL DEFAULT 'organization',
  confirmed_visibility text,
  source_thread_id uuid REFERENCES public.chat_threads(id),
  source_message_ids uuid[] NOT NULL DEFAULT '{}',
  source_user_id uuid REFERENCES auth.users(id),
  contains_personal_conversation boolean NOT NULL DEFAULT false,
  contains_personal_data boolean NOT NULL DEFAULT false,
  contains_compensation_data boolean NOT NULL DEFAULT false,
  classification_reasons text[] NOT NULL DEFAULT '{}',
  classification_confidence numeric(4,3),
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

ALTER TABLE public.knowledge_candidates ENABLE ROW LEVEL SECURITY;

-- Conversation audit cases (separated from normal search)
CREATE TABLE IF NOT EXISTS public.conversation_audit_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  reason text NOT NULL,
  target_user_id uuid NOT NULL REFERENCES auth.users(id),
  period_start timestamptz,
  period_end timestamptz,
  target_thread_id uuid REFERENCES public.chat_threads(id),
  opened_by uuid NOT NULL REFERENCES auth.users(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  viewed_resource_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

ALTER TABLE public.conversation_audit_cases ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Permissions seed
-- ---------------------------------------------------------------------------

INSERT INTO public.permissions (key, label) VALUES
  ('conversation:read_own', 'Read own conversations'),
  ('conversation:share', 'Share conversations'),
  ('conversation:audit', 'Audit conversations'),
  ('conversation:audit_manage', 'Manage conversation audits'),
  ('clearance:manage', 'Manage membership clearance overrides')
ON CONFLICT (key) DO NOTHING;

-- Admin role already gets all via bulk insert pattern — refresh for new keys
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.org_id IS NULL AND r.key = 'admin'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r, public.permissions p
WHERE r.org_id IS NULL AND r.key IN ('member', 'editor', 'manager')
  AND p.key IN ('conversation:read_own')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r, public.permissions p
WHERE r.org_id IS NULL AND r.key IN ('editor', 'manager')
  AND p.key IN ('conversation:share')
ON CONFLICT DO NOTHING;

-- NOTE: conversation:audit is NOT granted to manager/editor via executive clearance.
-- Grant narrowly per membership after documented approval.

-- ---------------------------------------------------------------------------
-- RLS helpers (DB is source of truth; JWT claims are advisory only)
-- ---------------------------------------------------------------------------

-- Drop leftover smallint overloads if a prior failed apply left them behind.
-- Fresh signatures use integer for level args (see CREATE comments below).
DROP FUNCTION IF EXISTS public.regapro_can_assign_confidentiality_level(uuid, smallint);
DROP FUNCTION IF EXISTS public.regapro_can_access_confidentiality_level(uuid, smallint);
DROP FUNCTION IF EXISTS public.regapro_can_access_resource(uuid, smallint, text, uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.regapro_can_access_labeled_row(uuid, smallint, text, uuid, uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.regapro_level_to_int(p_level text)
RETURNS smallint
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_level
    WHEN 'company' THEN 1::smallint
    WHEN 'people' THEN 2::smallint
    WHEN 'executive' THEN 3::smallint
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.regapro_effective_clearance_level(p_org_id uuid)
RETURNS smallint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    om.clearance_override,
    d.default_clearance_level,
    1
  )
  FROM public.organization_memberships om
  LEFT JOIN public.departments d ON d.id = om.department_id AND d.deleted_at IS NULL
  WHERE om.org_id = p_org_id
    AND om.user_id = auth.uid()
    AND om.deleted_at IS NULL
  LIMIT 1;
$$;

-- Level args use integer (not smallint) so SQL integer literals and smallint
-- columns both resolve. PostgreSQL will not match integer → smallint for functions.
CREATE OR REPLACE FUNCTION public.regapro_can_assign_confidentiality_level(
  p_org_id uuid,
  p_requested_level integer
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_requested_level BETWEEN 1 AND 3
    AND p_requested_level <= COALESCE(public.regapro_effective_clearance_level(p_org_id), 0);
$$;

CREATE OR REPLACE FUNCTION public.regapro_can_access_confidentiality_level(
  p_org_id uuid,
  p_resource_level integer
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_resource_level BETWEEN 1 AND 3
    AND p_resource_level <= COALESCE(public.regapro_effective_clearance_level(p_org_id), 0);
$$;

-- Owner or explicit chat participant. Does NOT grant admin / executive / audit access.
CREATE OR REPLACE FUNCTION public.regapro_can_read_private_thread(p_thread_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.chat_threads t
    WHERE t.id = p_thread_id
      AND t.deleted_at IS NULL
      AND (
        t.owner_user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.chat_participants cp
          WHERE cp.thread_id = t.id
            AND cp.user_id = auth.uid()
            AND cp.deleted_at IS NULL
        )
      )
  );
$$;

-- Audit capability only (does not open normal SELECT on conversations).
CREATE OR REPLACE FUNCTION public.regapro_has_conversation_audit_access(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.regapro_has_permission(p_org_id, 'conversation:audit');
$$;

-- Standalone visibility (no parent thread). Participants without a participant roster
-- collapses to owner-only; prefer origin_thread_id path for conversation-derived rows.
CREATE OR REPLACE FUNCTION public.regapro_can_access_resource(
  p_org_id uuid,
  p_confidentiality_level integer,
  p_visibility text,
  p_owner_user_id uuid,
  p_department_id uuid,
  p_project_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.regapro_is_org_member(p_org_id)
    AND public.regapro_can_access_confidentiality_level(p_org_id, p_confidentiality_level)
    AND (
      CASE p_visibility
        WHEN 'private' THEN p_owner_user_id IS NOT NULL AND p_owner_user_id = auth.uid()
        WHEN 'participants' THEN p_owner_user_id IS NOT NULL AND p_owner_user_id = auth.uid()
        WHEN 'department' THEN p_department_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.organization_memberships om
          WHERE om.org_id = p_org_id
            AND om.user_id = auth.uid()
            AND om.department_id = p_department_id
            AND om.deleted_at IS NULL
        )
        WHEN 'project' THEN p_project_id IS NOT NULL
          AND public.regapro_is_project_member(p_project_id)
        WHEN 'organization' THEN true
        WHEN 'restricted' THEN p_owner_user_id IS NOT NULL AND p_owner_user_id = auth.uid()
        ELSE false
      END
    );
$$;

-- Normal conversation access: org + clearance + visibility. No audit bypass.
CREATE OR REPLACE FUNCTION public.regapro_can_access_thread(p_thread_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.chat_threads t
    WHERE t.id = p_thread_id
      AND t.deleted_at IS NULL
      AND public.regapro_is_org_member(t.org_id)
      AND public.regapro_can_access_confidentiality_level(t.org_id, t.confidentiality_level)
      AND (
        CASE t.visibility
          WHEN 'private' THEN public.regapro_can_read_private_thread(t.id)
          WHEN 'participants' THEN public.regapro_can_read_private_thread(t.id)
          WHEN 'department' THEN t.department_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.organization_memberships om
            WHERE om.org_id = t.org_id
              AND om.user_id = auth.uid()
              AND om.department_id = t.department_id
              AND om.deleted_at IS NULL
          )
          WHEN 'project' THEN t.project_id IS NOT NULL
            AND public.regapro_is_project_member(t.project_id)
          WHEN 'organization' THEN true
          WHEN 'restricted' THEN t.owner_user_id = auth.uid()
          ELSE false
        END
      )
  );
$$;

-- Derived / labeled rows: prefer parent-thread gate; else standalone labels.
CREATE OR REPLACE FUNCTION public.regapro_can_access_labeled_row(
  p_org_id uuid,
  p_confidentiality_level integer,
  p_visibility text,
  p_owner_user_id uuid,
  p_department_id uuid,
  p_project_id uuid,
  p_origin_thread_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.regapro_is_org_member(p_org_id)
    AND public.regapro_can_access_confidentiality_level(p_org_id, p_confidentiality_level)
    AND (
      CASE
        WHEN p_origin_thread_id IS NOT NULL THEN
          public.regapro_can_access_thread(p_origin_thread_id)
        ELSE
          public.regapro_can_access_resource(
            p_org_id,
            p_confidentiality_level,
            p_visibility,
            p_owner_user_id,
            p_department_id,
            p_project_id
          )
      END
    );
$$;

-- Storage objects: fail closed unless a matching file_objects row is readable.
CREATE OR REPLACE FUNCTION public.regapro_can_access_storage_object(
  p_bucket text,
  p_name text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.file_objects fo
    WHERE fo.bucket = p_bucket
      AND fo.path = p_name
      AND fo.deleted_at IS NULL
      AND public.regapro_can_access_labeled_row(
        fo.org_id,
        fo.confidentiality_level,
        fo.visibility,
        fo.created_by,
        NULL,
        NULL,
        fo.origin_thread_id
      )
  );
$$;

REVOKE ALL ON FUNCTION public.regapro_effective_clearance_level(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_can_assign_confidentiality_level(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_can_access_confidentiality_level(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_can_read_private_thread(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_has_conversation_audit_access(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_can_access_resource(uuid, integer, text, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_can_access_thread(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_can_access_labeled_row(uuid, integer, text, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_can_access_storage_object(text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.regapro_effective_clearance_level(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.regapro_can_assign_confidentiality_level(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.regapro_can_access_confidentiality_level(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.regapro_can_read_private_thread(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.regapro_has_conversation_audit_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.regapro_can_access_resource(uuid, integer, text, uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.regapro_can_access_thread(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.regapro_can_access_labeled_row(uuid, integer, text, uuid, uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.regapro_can_access_storage_object(text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Drop any legacy / conflicting policies (safe if absent)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS org_member_select ON public.chat_threads;
DROP POLICY IF EXISTS chat_threads_select ON public.chat_threads;
DROP POLICY IF EXISTS chat_threads_insert ON public.chat_threads;
DROP POLICY IF EXISTS chat_threads_update ON public.chat_threads;

DROP POLICY IF EXISTS org_member_select ON public.chat_participants;
DROP POLICY IF EXISTS org_member_select ON public.chat_messages;
DROP POLICY IF EXISTS chat_messages_select ON public.chat_messages;
DROP POLICY IF EXISTS chat_messages_insert ON public.chat_messages;
DROP POLICY IF EXISTS org_member_select ON public.message_citations;
DROP POLICY IF EXISTS org_member_select ON public.message_attachments;

DROP POLICY IF EXISTS org_member_select_tasks ON public.tasks;
DROP POLICY IF EXISTS task_manage ON public.tasks;
DROP POLICY IF EXISTS tasks_insert ON public.tasks;
DROP POLICY IF EXISTS tasks_update ON public.tasks;
DROP POLICY IF EXISTS org_member_select ON public.task_reminders;
DROP POLICY IF EXISTS org_member_select ON public.task_events;

DROP POLICY IF EXISTS org_member_select ON public.artifacts;
DROP POLICY IF EXISTS artifacts_select ON public.artifacts;
DROP POLICY IF EXISTS artifacts_insert ON public.artifacts;
DROP POLICY IF EXISTS org_member_select ON public.artifact_versions;
DROP POLICY IF EXISTS org_member_select ON public.artifact_jobs;

DROP POLICY IF EXISTS org_member_select_research ON public.research_runs;
DROP POLICY IF EXISTS research_run ON public.research_runs;
DROP POLICY IF EXISTS org_member_select ON public.research_queries;
DROP POLICY IF EXISTS org_member_select ON public.research_sources;
DROP POLICY IF EXISTS org_member_select ON public.research_findings;
DROP POLICY IF EXISTS org_member_select ON public.research_jobs;

DROP POLICY IF EXISTS org_member_select_knowledge ON public.knowledge_documents;
DROP POLICY IF EXISTS knowledge_write ON public.knowledge_documents;
DROP POLICY IF EXISTS knowledge_update ON public.knowledge_documents;
DROP POLICY IF EXISTS knowledge_documents_select ON public.knowledge_documents;
DROP POLICY IF EXISTS org_member_select ON public.knowledge_sources;
DROP POLICY IF EXISTS org_member_select ON public.knowledge_document_versions;
DROP POLICY IF EXISTS org_member_select ON public.knowledge_chunks;
DROP POLICY IF EXISTS org_member_select ON public.knowledge_facts;
DROP POLICY IF EXISTS org_member_select ON public.knowledge_revisions;
DROP POLICY IF EXISTS org_member_select ON public.knowledge_approvals;
DROP POLICY IF EXISTS knowledge_candidates_rw ON public.knowledge_candidates;

DROP POLICY IF EXISTS org_member_select ON public.generated_prompts;
DROP POLICY IF EXISTS prompts_select ON public.generated_prompts;
DROP POLICY IF EXISTS prompts_insert ON public.generated_prompts;
DROP POLICY IF EXISTS org_member_select ON public.prompt_execution_results;

DROP POLICY IF EXISTS org_member_select ON public.file_objects;
DROP POLICY IF EXISTS file_objects_select ON public.file_objects;
DROP POLICY IF EXISTS org_member_select ON public.memory_items;
DROP POLICY IF EXISTS org_member_select ON public.tool_executions;

DROP POLICY IF EXISTS storage_org_read ON storage.objects;
DROP POLICY IF EXISTS storage_org_insert ON storage.objects;
DROP POLICY IF EXISTS storage_org_update ON storage.objects;
DROP POLICY IF EXISTS storage_org_delete ON storage.objects;

DROP POLICY IF EXISTS conversation_audit_cases_select ON public.conversation_audit_cases;
DROP POLICY IF EXISTS conversation_audit_cases_insert ON public.conversation_audit_cases;

-- ---------------------------------------------------------------------------
-- chat_threads — normal access only (no conversation:audit OR)
-- ---------------------------------------------------------------------------

CREATE POLICY chat_threads_select ON public.chat_threads
  FOR SELECT TO authenticated
  USING (public.regapro_can_access_thread(id));

CREATE POLICY chat_threads_insert ON public.chat_threads
  FOR INSERT TO authenticated
  WITH CHECK (
    public.regapro_has_permission(org_id, 'chat:use')
    AND public.regapro_can_assign_confidentiality_level(org_id, confidentiality_level)
    AND owner_user_id = auth.uid()
    AND (
      CASE visibility
        WHEN 'private' THEN owner_user_id = auth.uid()
        WHEN 'participants' THEN owner_user_id = auth.uid()
        WHEN 'department' THEN department_id IS NOT NULL
        WHEN 'project' THEN project_id IS NOT NULL
        WHEN 'organization' THEN true
        WHEN 'restricted' THEN owner_user_id = auth.uid()
        ELSE false
      END
    )
  );

CREATE POLICY chat_threads_update ON public.chat_threads
  FOR UPDATE TO authenticated
  USING (
    owner_user_id = auth.uid()
    OR public.regapro_has_permission(org_id, 'clearance:manage')
  )
  WITH CHECK (
    public.regapro_can_assign_confidentiality_level(org_id, confidentiality_level)
    AND minimum_derived_level <= confidentiality_level
  );

-- ---------------------------------------------------------------------------
-- chat_messages / participants / citations / attachments
-- ---------------------------------------------------------------------------

CREATE POLICY chat_messages_select ON public.chat_messages
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.chat_threads t
      WHERE t.id = thread_id
        AND public.regapro_can_access_thread(t.id)
        AND public.regapro_can_access_confidentiality_level(t.org_id, confidentiality_level)
    )
  );

CREATE POLICY chat_messages_insert ON public.chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.chat_threads t
      WHERE t.id = thread_id
        AND t.deleted_at IS NULL
        AND public.regapro_can_access_thread(t.id)
        AND public.regapro_can_assign_confidentiality_level(t.org_id, confidentiality_level)
        AND confidentiality_level <= t.confidentiality_level
    )
  );

CREATE POLICY chat_participants_select ON public.chat_participants
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      user_id = auth.uid()
      OR public.regapro_can_access_thread(thread_id)
    )
  );

CREATE POLICY message_citations_select ON public.message_citations
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.chat_messages m
      JOIN public.chat_threads t ON t.id = m.thread_id
      WHERE m.id = message_id
        AND public.regapro_can_access_thread(t.id)
        AND public.regapro_can_access_confidentiality_level(t.org_id, m.confidentiality_level)
    )
  );

CREATE POLICY message_attachments_select ON public.message_attachments
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.chat_messages m
      JOIN public.chat_threads t ON t.id = m.thread_id
      WHERE m.id = message_id
        AND public.regapro_can_access_thread(t.id)
        AND public.regapro_can_access_confidentiality_level(t.org_id, m.confidentiality_level)
    )
  );

-- ---------------------------------------------------------------------------
-- tasks (+ children)
-- ---------------------------------------------------------------------------

CREATE POLICY tasks_select ON public.tasks
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.regapro_can_access_labeled_row(
      org_id, confidentiality_level, visibility, created_by, NULL, project_id, origin_thread_id
    )
  );

CREATE POLICY tasks_insert ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    public.regapro_has_permission(org_id, 'task:create')
    AND created_by = auth.uid()
    AND public.regapro_can_assign_confidentiality_level(org_id, confidentiality_level)
    AND (
      origin_thread_id IS NULL
      OR public.regapro_can_access_thread(origin_thread_id)
    )
  );

CREATE POLICY tasks_update ON public.tasks
  FOR UPDATE TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      public.regapro_has_permission(org_id, 'task:update')
      OR assignee_id = auth.uid()
      OR created_by = auth.uid()
    )
    AND public.regapro_can_access_labeled_row(
      org_id, confidentiality_level, visibility, created_by, NULL, project_id, origin_thread_id
    )
  )
  WITH CHECK (
    public.regapro_can_assign_confidentiality_level(org_id, confidentiality_level)
    AND minimum_derived_level <= confidentiality_level
  );

CREATE POLICY tasks_manage ON public.tasks
  FOR ALL TO authenticated
  USING (
    public.regapro_has_permission(org_id, 'task:manage')
    AND public.regapro_can_access_labeled_row(
      org_id, confidentiality_level, visibility, created_by, NULL, project_id, origin_thread_id
    )
  )
  WITH CHECK (
    public.regapro_has_permission(org_id, 'task:manage')
    AND public.regapro_can_assign_confidentiality_level(org_id, confidentiality_level)
  );

CREATE POLICY task_reminders_select ON public.task_reminders
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.tasks tk
        WHERE tk.id = task_id
          AND public.regapro_can_access_labeled_row(
            tk.org_id, tk.confidentiality_level, tk.visibility,
            tk.created_by, NULL, tk.project_id, tk.origin_thread_id
          )
      )
    )
  );

CREATE POLICY task_events_select ON public.task_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tasks tk
      WHERE tk.id = task_id
        AND public.regapro_can_access_labeled_row(
          tk.org_id, tk.confidentiality_level, tk.visibility,
          tk.created_by, NULL, tk.project_id, tk.origin_thread_id
        )
    )
  );

-- ---------------------------------------------------------------------------
-- artifacts (+ children)
-- ---------------------------------------------------------------------------

CREATE POLICY artifacts_select ON public.artifacts
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.regapro_can_access_labeled_row(
      org_id, confidentiality_level, visibility, created_by, NULL, project_id, origin_thread_id
    )
  );

CREATE POLICY artifacts_insert ON public.artifacts
  FOR INSERT TO authenticated
  WITH CHECK (
    public.regapro_has_permission(org_id, 'artifact:generate')
    AND created_by = auth.uid()
    AND public.regapro_can_assign_confidentiality_level(org_id, confidentiality_level)
    AND (
      origin_thread_id IS NULL
      OR public.regapro_can_access_thread(origin_thread_id)
    )
  );

CREATE POLICY artifact_versions_select ON public.artifact_versions
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.artifacts a
      WHERE a.id = artifact_id
        AND public.regapro_can_access_labeled_row(
          a.org_id, a.confidentiality_level, a.visibility,
          a.created_by, NULL, a.project_id, a.origin_thread_id
        )
    )
  );

CREATE POLICY artifact_jobs_select ON public.artifact_jobs
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.regapro_is_org_member(org_id)
    AND EXISTS (
      SELECT 1 FROM public.artifacts a
      WHERE a.id = artifact_id
        AND public.regapro_can_access_labeled_row(
          a.org_id, a.confidentiality_level, a.visibility,
          a.created_by, NULL, a.project_id, a.origin_thread_id
        )
    )
  );

-- ---------------------------------------------------------------------------
-- research (+ children)
-- ---------------------------------------------------------------------------

CREATE POLICY research_runs_select ON public.research_runs
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.regapro_can_access_labeled_row(
      org_id, confidentiality_level, visibility, created_by, NULL, project_id, origin_thread_id
    )
  );

CREATE POLICY research_runs_insert ON public.research_runs
  FOR INSERT TO authenticated
  WITH CHECK (
    public.regapro_has_permission(org_id, 'research:run')
    AND created_by = auth.uid()
    AND public.regapro_can_assign_confidentiality_level(org_id, confidentiality_level)
    AND (
      origin_thread_id IS NULL
      OR public.regapro_can_access_thread(origin_thread_id)
    )
  );

CREATE POLICY research_queries_select ON public.research_queries
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.research_runs r
      WHERE r.id = run_id
        AND public.regapro_can_access_labeled_row(
          r.org_id, r.confidentiality_level, r.visibility,
          r.created_by, NULL, r.project_id, r.origin_thread_id
        )
    )
  );

CREATE POLICY research_sources_select ON public.research_sources
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.research_runs r
      WHERE r.id = run_id
        AND public.regapro_can_access_labeled_row(
          r.org_id, r.confidentiality_level, r.visibility,
          r.created_by, NULL, r.project_id, r.origin_thread_id
        )
    )
  );

CREATE POLICY research_findings_select ON public.research_findings
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.research_runs r
      WHERE r.id = run_id
        AND public.regapro_can_access_confidentiality_level(r.org_id, confidentiality_level)
        AND public.regapro_can_access_labeled_row(
          r.org_id, r.confidentiality_level, r.visibility,
          r.created_by, NULL, r.project_id, r.origin_thread_id
        )
    )
  );

CREATE POLICY research_jobs_select ON public.research_jobs
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.regapro_is_org_member(org_id)
    AND EXISTS (
      SELECT 1 FROM public.research_runs r
      WHERE r.id = run_id
        AND public.regapro_can_access_labeled_row(
          r.org_id, r.confidentiality_level, r.visibility,
          r.created_by, NULL, r.project_id, r.origin_thread_id
        )
    )
  );

-- ---------------------------------------------------------------------------
-- knowledge (+ children / candidates)
-- ---------------------------------------------------------------------------

CREATE POLICY knowledge_documents_select ON public.knowledge_documents
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.regapro_can_access_confidentiality_level(org_id, confidentiality_level)
    AND (
      (
        status = 'published'
        AND (
          (origin_thread_id IS NOT NULL AND public.regapro_can_access_thread(origin_thread_id))
          OR (
            origin_thread_id IS NULL
            AND visibility = 'organization'
            AND public.regapro_is_org_member(org_id)
          )
        )
      )
      OR public.regapro_has_permission(org_id, 'knowledge:review')
      OR public.regapro_has_permission(org_id, 'knowledge:write')
    )
  );

CREATE POLICY knowledge_documents_insert ON public.knowledge_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    public.regapro_has_permission(org_id, 'knowledge:write')
    AND public.regapro_can_assign_confidentiality_level(org_id, confidentiality_level)
  );

CREATE POLICY knowledge_documents_update ON public.knowledge_documents
  FOR UPDATE TO authenticated
  USING (
    public.regapro_has_permission(org_id, 'knowledge:write')
    OR public.regapro_has_permission(org_id, 'knowledge:review')
    OR public.regapro_has_permission(org_id, 'knowledge:approve')
  )
  WITH CHECK (
    public.regapro_can_assign_confidentiality_level(org_id, confidentiality_level)
  );

CREATE POLICY knowledge_sources_select ON public.knowledge_sources
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.regapro_is_org_member(org_id)
    AND public.regapro_can_access_confidentiality_level(org_id, 1)
  );

CREATE POLICY knowledge_document_versions_select ON public.knowledge_document_versions
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.knowledge_documents d
      WHERE d.id = document_id
        AND d.deleted_at IS NULL
        AND public.regapro_can_access_confidentiality_level(d.org_id, d.confidentiality_level)
        AND (
          (
            d.status = 'published'
            AND (
              (d.origin_thread_id IS NOT NULL AND public.regapro_can_access_thread(d.origin_thread_id))
              OR (
                d.origin_thread_id IS NULL
                AND d.visibility = 'organization'
                AND public.regapro_is_org_member(d.org_id)
              )
            )
          )
          OR public.regapro_has_permission(d.org_id, 'knowledge:review')
          OR public.regapro_has_permission(d.org_id, 'knowledge:write')
        )
    )
  );

CREATE POLICY knowledge_chunks_select ON public.knowledge_chunks
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.knowledge_document_versions v
      JOIN public.knowledge_documents d ON d.id = v.document_id
      WHERE v.id = document_version_id
        AND d.deleted_at IS NULL
        AND public.regapro_can_access_confidentiality_level(d.org_id, d.confidentiality_level)
        AND (
          (
            d.status = 'published'
            AND (
              (d.origin_thread_id IS NOT NULL AND public.regapro_can_access_thread(d.origin_thread_id))
              OR (
                d.origin_thread_id IS NULL
                AND d.visibility = 'organization'
                AND public.regapro_is_org_member(d.org_id)
              )
            )
          )
          OR public.regapro_has_permission(d.org_id, 'knowledge:review')
          OR public.regapro_has_permission(d.org_id, 'knowledge:write')
        )
    )
  );

CREATE POLICY knowledge_facts_select ON public.knowledge_facts
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.regapro_is_org_member(org_id)
    AND public.regapro_can_access_confidentiality_level(org_id, 1)
    AND (
      document_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.knowledge_documents d
        WHERE d.id = document_id
          AND public.regapro_can_access_confidentiality_level(d.org_id, d.confidentiality_level)
          AND (
            (d.status = 'published' AND d.visibility = 'organization')
            OR public.regapro_has_permission(d.org_id, 'knowledge:review')
          )
      )
    )
  );

CREATE POLICY knowledge_revisions_select ON public.knowledge_revisions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.knowledge_documents d
      WHERE d.id = document_id
        AND (
          public.regapro_has_permission(d.org_id, 'knowledge:review')
          OR public.regapro_has_permission(d.org_id, 'knowledge:write')
        )
    )
  );

CREATE POLICY knowledge_approvals_select ON public.knowledge_approvals
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.knowledge_documents d
      WHERE d.id = document_id
        AND (
          public.regapro_has_permission(d.org_id, 'knowledge:review')
          OR public.regapro_has_permission(d.org_id, 'knowledge:approve')
        )
    )
  );

CREATE POLICY knowledge_candidates_select ON public.knowledge_candidates
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.regapro_is_org_member(org_id)
    AND public.regapro_can_access_confidentiality_level(
      org_id,
      COALESCE(confirmed_confidentiality_level, suggested_confidentiality_level)
    )
    AND (
      source_user_id = auth.uid()
      OR public.regapro_has_permission(org_id, 'knowledge:review')
    )
  );

CREATE POLICY knowledge_candidates_insert ON public.knowledge_candidates
  FOR INSERT TO authenticated
  WITH CHECK (
    public.regapro_is_org_member(org_id)
    AND source_user_id = auth.uid()
    AND public.regapro_can_assign_confidentiality_level(
      org_id,
      COALESCE(confirmed_confidentiality_level, suggested_confidentiality_level)
    )
  );

CREATE POLICY knowledge_candidates_update ON public.knowledge_candidates
  FOR UPDATE TO authenticated
  USING (
    source_user_id = auth.uid()
    OR public.regapro_has_permission(org_id, 'knowledge:review')
  )
  WITH CHECK (
    public.regapro_can_assign_confidentiality_level(
      org_id,
      COALESCE(confirmed_confidentiality_level, suggested_confidentiality_level)
    )
  );

-- ---------------------------------------------------------------------------
-- generated_prompts / prompt_execution_results
-- ---------------------------------------------------------------------------

CREATE POLICY generated_prompts_select ON public.generated_prompts
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.regapro_can_access_labeled_row(
      org_id, confidentiality_level, visibility, created_by, NULL, NULL, origin_thread_id
    )
  );

CREATE POLICY generated_prompts_insert ON public.generated_prompts
  FOR INSERT TO authenticated
  WITH CHECK (
    public.regapro_has_permission(org_id, 'prompt:generate')
    AND public.regapro_can_assign_confidentiality_level(org_id, confidentiality_level)
    AND (created_by IS NULL OR created_by = auth.uid())
  );

CREATE POLICY prompt_execution_results_select ON public.prompt_execution_results
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.generated_prompts gp
      WHERE gp.id = prompt_id
        AND public.regapro_can_access_labeled_row(
          gp.org_id, gp.confidentiality_level, gp.visibility,
          gp.created_by, NULL, NULL, gp.origin_thread_id
        )
    )
  );

-- ---------------------------------------------------------------------------
-- file_objects / memory_items / tool_executions
-- ---------------------------------------------------------------------------

CREATE POLICY file_objects_select ON public.file_objects
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.regapro_can_access_labeled_row(
      org_id, confidentiality_level, visibility, created_by, NULL, NULL, origin_thread_id
    )
  );

CREATE POLICY file_objects_insert ON public.file_objects
  FOR INSERT TO authenticated
  WITH CHECK (
    public.regapro_is_org_member(org_id)
    AND created_by = auth.uid()
    AND public.regapro_can_assign_confidentiality_level(org_id, confidentiality_level)
    AND (
      origin_thread_id IS NULL
      OR public.regapro_can_access_thread(origin_thread_id)
    )
  );

CREATE POLICY memory_items_select ON public.memory_items
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.regapro_can_access_labeled_row(
      org_id, confidentiality_level, visibility, user_id, NULL, NULL, origin_thread_id
    )
  );

CREATE POLICY tool_executions_select ON public.tool_executions
  FOR SELECT TO authenticated
  USING (
    public.regapro_can_access_labeled_row(
      org_id, confidentiality_level, visibility, created_by, NULL, NULL, origin_thread_id
    )
  );

-- ---------------------------------------------------------------------------
-- conversation:audit — separated from normal conversation SELECT
-- ---------------------------------------------------------------------------

CREATE POLICY conversation_audit_cases_select ON public.conversation_audit_cases
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.regapro_has_conversation_audit_access(org_id)
  );

CREATE POLICY conversation_audit_cases_insert ON public.conversation_audit_cases
  FOR INSERT TO authenticated
  WITH CHECK (
    public.regapro_has_permission(org_id, 'conversation:audit_manage')
    OR public.regapro_has_conversation_audit_access(org_id)
  );

-- ---------------------------------------------------------------------------
-- storage.objects — org buckets gated by file_objects labels
-- ---------------------------------------------------------------------------

CREATE POLICY storage_org_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id IN ('knowledge-files', 'chat-attachments', 'artifacts', 'research-snapshots')
    AND public.regapro_can_access_storage_object(bucket_id, name)
  );

CREATE POLICY storage_org_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id IN ('knowledge-files', 'chat-attachments', 'artifacts', 'research-snapshots')
    AND name LIKE 'org/%'
    AND public.regapro_is_org_member((split_part(name, '/', 2))::uuid)
  );

CREATE POLICY storage_org_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id IN ('knowledge-files', 'chat-attachments', 'artifacts', 'research-snapshots')
    AND public.regapro_can_access_storage_object(bucket_id, name)
  )
  WITH CHECK (
    bucket_id IN ('knowledge-files', 'chat-attachments', 'artifacts', 'research-snapshots')
    AND public.regapro_can_access_storage_object(bucket_id, name)
  );

CREATE POLICY storage_org_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id IN ('knowledge-files', 'chat-attachments', 'artifacts', 'research-snapshots')
    AND public.regapro_can_access_storage_object(bucket_id, name)
  );

-- Seed department keys (org-agnostic templates if orgs exist)
-- Applied only after orgs are bootstrapped by operators.
