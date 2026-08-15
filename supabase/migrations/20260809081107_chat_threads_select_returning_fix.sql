-- Fix chat_threads SELECT for INSERT ... RETURNING.
--
-- Using regapro_can_access_thread(id) re-queries chat_threads by id. During
-- INSERT ... RETURNING, PostgREST/Postgres can evaluate SELECT RLS before that
-- subquery sees the new row, producing a false deny ("violates row-level
-- security") even when WITH CHECK on INSERT would allow the write.
--
-- Select now evaluates the current row's label columns in place (same
-- confidentiality + visibility rules; no admin/audit bypass added).

DROP POLICY IF EXISTS chat_threads_select ON public.chat_threads;

CREATE POLICY chat_threads_select ON public.chat_threads
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.regapro_is_org_member(org_id)
    AND public.regapro_can_access_confidentiality_level(org_id, confidentiality_level)
    AND (
      CASE visibility
        WHEN 'private' THEN (
          owner_user_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.chat_participants cp
            WHERE cp.thread_id = chat_threads.id
              AND cp.user_id = auth.uid()
              AND cp.deleted_at IS NULL
          )
        )
        WHEN 'participants' THEN (
          owner_user_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.chat_participants cp
            WHERE cp.thread_id = chat_threads.id
              AND cp.user_id = auth.uid()
              AND cp.deleted_at IS NULL
          )
        )
        WHEN 'department' THEN
          department_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.organization_memberships om
            WHERE om.org_id = chat_threads.org_id
              AND om.user_id = auth.uid()
              AND om.department_id = chat_threads.department_id
              AND om.deleted_at IS NULL
          )
        WHEN 'project' THEN
          project_id IS NOT NULL
          AND public.regapro_is_project_member(project_id)
        WHEN 'organization' THEN true
        WHEN 'restricted' THEN owner_user_id = auth.uid()
        ELSE false
      END
    )
  );

-- Helper remains for FK-gated children (messages, derived rows, etc.).
COMMENT ON FUNCTION public.regapro_can_access_thread(uuid) IS
  'Lookup helper for FK-gated child access. chat_threads SELECT policy uses row columns directly for INSERT RETURNING correctness.';
