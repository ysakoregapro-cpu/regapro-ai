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

CREATE OR REPLACE FUNCTION public.regapro_can_assign_confidentiality_level(
  p_org_id uuid,
  p_requested_level smallint
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
  p_resource_level smallint
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
          WHERE cp.thread_id = t.id AND cp.user_id = auth.uid()
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.regapro_has_conversation_audit_access(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.regapro_has_permission(p_org_id, 'conversation:audit');
$$;

CREATE OR REPLACE FUNCTION public.regapro_can_access_resource(
  p_org_id uuid,
  p_confidentiality_level smallint,
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
        WHEN 'private' THEN p_owner_user_id = auth.uid()
        WHEN 'participants' THEN p_owner_user_id = auth.uid()
        WHEN 'department' THEN EXISTS (
          SELECT 1 FROM public.organization_memberships om
          WHERE om.org_id = p_org_id
            AND om.user_id = auth.uid()
            AND om.department_id = p_department_id
            AND om.deleted_at IS NULL
        )
        WHEN 'project' THEN p_project_id IS NOT NULL
          AND public.regapro_is_project_member(p_project_id)
        WHEN 'organization' THEN true
        WHEN 'restricted' THEN p_owner_user_id = auth.uid()
        ELSE false
      END
    );
$$;

REVOKE ALL ON FUNCTION public.regapro_effective_clearance_level(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_can_assign_confidentiality_level(uuid, smallint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_can_access_confidentiality_level(uuid, smallint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_can_read_private_thread(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_has_conversation_audit_access(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_can_access_resource(uuid, smallint, text, uuid, uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.regapro_effective_clearance_level(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.regapro_can_assign_confidentiality_level(uuid, smallint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.regapro_can_access_confidentiality_level(uuid, smallint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.regapro_can_read_private_thread(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.regapro_has_conversation_audit_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.regapro_can_access_resource(uuid, smallint, text, uuid, uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Replace chat_threads policies with confidentiality-aware access
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS chat_threads_select ON public.chat_threads;
DROP POLICY IF EXISTS chat_threads_insert ON public.chat_threads;

CREATE POLICY chat_threads_select ON public.chat_threads
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.regapro_is_org_member(org_id)
    AND public.regapro_can_access_confidentiality_level(org_id, confidentiality_level)
    AND (
      (visibility = 'private' AND public.regapro_can_read_private_thread(id))
      OR (visibility <> 'private' AND public.regapro_can_access_resource(
        org_id, confidentiality_level, visibility, owner_user_id, department_id, project_id
      ))
      OR public.regapro_has_conversation_audit_access(org_id)
    )
  );

CREATE POLICY chat_threads_insert ON public.chat_threads
  FOR INSERT TO authenticated
  WITH CHECK (
    public.regapro_has_permission(org_id, 'chat:use')
    AND public.regapro_can_assign_confidentiality_level(org_id, confidentiality_level)
    AND owner_user_id = auth.uid()
    AND (visibility <> 'private' OR owner_user_id = auth.uid())
  );

CREATE POLICY chat_threads_update ON public.chat_threads
  FOR UPDATE TO authenticated
  USING (
    owner_user_id = auth.uid()
    OR public.regapro_has_permission(org_id, 'organization:manage')
  )
  WITH CHECK (
    public.regapro_can_assign_confidentiality_level(org_id, confidentiality_level)
    AND minimum_derived_level <= confidentiality_level
  );

CREATE POLICY chat_messages_insert ON public.chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.chat_threads t
      WHERE t.id = thread_id
        AND t.deleted_at IS NULL
        AND public.regapro_can_read_private_thread(t.id)
        AND public.regapro_can_assign_confidentiality_level(t.org_id, confidentiality_level)
        AND confidentiality_level <= t.confidentiality_level
    )
  );

CREATE POLICY knowledge_documents_select ON public.knowledge_documents
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND status = 'published'
    AND public.regapro_can_access_resource(
      org_id,
      confidentiality_level,
      visibility,
      NULL,
      NULL,
      NULL
    )
  );

CREATE POLICY conversation_audit_cases_select ON public.conversation_audit_cases
  FOR SELECT TO authenticated
  USING (public.regapro_has_conversation_audit_access(org_id));

CREATE POLICY conversation_audit_cases_insert ON public.conversation_audit_cases
  FOR INSERT TO authenticated
  WITH CHECK (
    public.regapro_has_permission(org_id, 'conversation:audit_manage')
    OR public.regapro_has_conversation_audit_access(org_id)
  );

CREATE POLICY knowledge_candidates_rw ON public.knowledge_candidates
  FOR ALL TO authenticated
  USING (
    source_user_id = auth.uid()
    OR public.regapro_has_permission(org_id, 'knowledge:review')
  )
  WITH CHECK (
    source_user_id = auth.uid()
    OR public.regapro_has_permission(org_id, 'knowledge:write')
  );

-- Seed department keys (org-agnostic templates if orgs exist)
-- Applied only after orgs are bootstrapped by operators.
