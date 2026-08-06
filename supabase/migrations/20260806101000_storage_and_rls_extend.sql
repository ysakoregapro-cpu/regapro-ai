-- Storage buckets + extended RLS policies
-- Do not apply to remote without human review.

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
    WHEN 'team' THEN public.regapro_is_org_member(p_org_id)
    WHEN 'department' THEN EXISTS (
      SELECT 1 FROM public.organization_memberships om
      WHERE om.org_id = p_org_id
        AND om.user_id = auth.uid()
        AND om.department_id = p_department_id
        AND om.deleted_at IS NULL
    )
    WHEN 'project' THEN p_project_id IS NOT NULL AND public.regapro_is_project_member(p_project_id)
    WHEN 'organization' THEN public.regapro_is_org_member(p_org_id)
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
-- Extended table policies (authenticated explicit)
-- ---------------------------------------------------------------------------

CREATE POLICY projects_insert ON public.projects
  FOR INSERT TO authenticated
  WITH CHECK (public.regapro_has_permission(org_id, 'project:manage'));

CREATE POLICY projects_update ON public.projects
  FOR UPDATE TO authenticated
  USING (public.regapro_has_permission(org_id, 'project:manage'))
  WITH CHECK (public.regapro_has_permission(org_id, 'project:manage'));

CREATE POLICY tasks_insert ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK (public.regapro_has_permission(org_id, 'task:create'));

CREATE POLICY tasks_update ON public.tasks
  FOR UPDATE TO authenticated
  USING (
    public.regapro_has_permission(org_id, 'task:update')
    OR assignee_id = auth.uid()
    OR created_by = auth.uid()
  )
  WITH CHECK (
    public.regapro_has_permission(org_id, 'task:update')
    OR assignee_id = auth.uid()
    OR created_by = auth.uid()
  );

CREATE POLICY chat_threads_select ON public.chat_threads
  FOR SELECT TO authenticated
  USING (public.regapro_is_org_member(org_id) AND deleted_at IS NULL);

CREATE POLICY chat_threads_insert ON public.chat_threads
  FOR INSERT TO authenticated
  WITH CHECK (public.regapro_has_permission(org_id, 'chat:use'));

CREATE POLICY chat_messages_select ON public.chat_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_threads t
      WHERE t.id = thread_id
        AND public.regapro_is_org_member(t.org_id)
        AND t.deleted_at IS NULL
    )
  );

CREATE POLICY artifacts_select ON public.artifacts
  FOR SELECT TO authenticated
  USING (public.regapro_is_org_member(org_id) AND deleted_at IS NULL);

CREATE POLICY artifacts_insert ON public.artifacts
  FOR INSERT TO authenticated
  WITH CHECK (public.regapro_has_permission(org_id, 'artifact:generate'));

CREATE POLICY prompts_select ON public.generated_prompts
  FOR SELECT TO authenticated
  USING (public.regapro_is_org_member(org_id) AND deleted_at IS NULL);

CREATE POLICY prompts_insert ON public.generated_prompts
  FOR INSERT TO authenticated
  WITH CHECK (public.regapro_has_permission(org_id, 'prompt:generate'));

CREATE POLICY knowledge_update ON public.knowledge_documents
  FOR UPDATE TO authenticated
  USING (
    public.regapro_has_permission(org_id, 'knowledge:write')
    OR public.regapro_has_permission(org_id, 'knowledge:review')
    OR public.regapro_has_permission(org_id, 'knowledge:approve')
  )
  WITH CHECK (
    public.regapro_has_permission(org_id, 'knowledge:write')
    OR public.regapro_has_permission(org_id, 'knowledge:review')
    OR public.regapro_has_permission(org_id, 'knowledge:approve')
  );

CREATE POLICY file_objects_select ON public.file_objects
  FOR SELECT TO authenticated
  USING (public.regapro_is_org_member(org_id) AND deleted_at IS NULL);

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
