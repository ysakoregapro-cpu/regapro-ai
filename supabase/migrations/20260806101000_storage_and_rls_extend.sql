-- Storage buckets + extended RLS policies
-- Do not apply to remote without human review.
--
-- Note: SELECT/write policies for confidentiality-labeled resources
-- (chat, tasks, artifacts, research, knowledge, files, prompts, memory, tools)
-- are intentionally deferred to 20260806120000_confidentiality_model.sql so the
-- final policy set has no permissive-OR bypass via org-member-only SELECT.

-- ---------------------------------------------------------------------------
-- Additional RLS helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.regapro_current_membership_id(p_org_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT om.id
  FROM public.organization_memberships om
  WHERE om.org_id = p_org_id
    AND om.user_id = auth.uid()
    AND om.deleted_at IS NULL
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.regapro_is_active_org_member(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_memberships om
    WHERE om.org_id = p_org_id
      AND om.user_id = auth.uid()
      AND om.deleted_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.regapro_is_project_member(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.project_members pm
    WHERE pm.project_id = p_project_id
      AND pm.user_id = auth.uid()
      AND pm.deleted_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.regapro_can_access_visibility(
  p_org_id uuid,
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
  SELECT CASE p_visibility
    WHEN 'private' THEN p_owner_user_id = auth.uid()
    WHEN 'participants' THEN p_owner_user_id = auth.uid()
    WHEN 'team' THEN public.regapro_is_org_member(p_org_id) -- legacy alias; prefer participants
    WHEN 'department' THEN EXISTS (
      SELECT 1 FROM public.organization_memberships om
      WHERE om.org_id = p_org_id
        AND om.user_id = auth.uid()
        AND om.department_id = p_department_id
        AND om.deleted_at IS NULL
    )
    WHEN 'project' THEN p_project_id IS NOT NULL AND public.regapro_is_project_member(p_project_id)
    WHEN 'organization' THEN public.regapro_is_org_member(p_org_id)
    WHEN 'restricted' THEN p_owner_user_id = auth.uid()
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.regapro_can_manage_resource(
  p_org_id uuid,
  p_permission text,
  p_owner_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.regapro_has_permission(p_org_id, p_permission)
    OR p_owner_user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Non-labeled resource write policies (projects + invitations + memberships)
-- Labeled-resource CRUD is created only in confidentiality_model migration.
-- ---------------------------------------------------------------------------

CREATE POLICY projects_insert ON public.projects
  FOR INSERT TO authenticated
  WITH CHECK (public.regapro_has_permission(org_id, 'project:manage'));

CREATE POLICY projects_update ON public.projects
  FOR UPDATE TO authenticated
  USING (public.regapro_has_permission(org_id, 'project:manage'))
  WITH CHECK (public.regapro_has_permission(org_id, 'project:manage'));

CREATE POLICY memberships_select ON public.organization_memberships
  FOR SELECT TO authenticated
  USING (public.regapro_is_org_member(org_id) OR user_id = auth.uid());

CREATE POLICY invitations_manage ON public.organization_invitations
  FOR ALL TO authenticated
  USING (public.regapro_has_permission(org_id, 'member:manage'))
  WITH CHECK (public.regapro_has_permission(org_id, 'member:manage'));

-- ---------------------------------------------------------------------------
-- Storage buckets (commented — apply after human review)
-- Path convention: {organizationId}/{projectId|common}/{resourceId}/{file}
-- ---------------------------------------------------------------------------

-- INSERT INTO storage.buckets (id, name, public, file_size_limit)
-- VALUES
--   ('knowledge-files', 'knowledge-files', false, 52428800),
--   ('chat-attachments', 'chat-attachments', false, 26214400),
--   ('artifacts', 'artifacts', false, 52428800),
--   ('research-snapshots', 'research-snapshots', false, 52428800),
--   ('user-avatars', 'user-avatars', false, 5242880)
-- ON CONFLICT (id) DO NOTHING;
