-- Integrated App Foundation v1 — Phase 1: Feature Permission (RBAC) axis.
--
-- Reuses the existing roles / permissions / role_permissions catalog rather
-- than creating a parallel one. Platform permission keys use dot notation
-- (expense.submit) so they never collide with the legacy AI capability keys
-- that use colon notation (chat:use). The two namespaces are separate axes and
-- separate join paths: membership_roles for AI, staff_role_assignments for the
-- integrated app.
--
-- Feature Permission is NOT Knowledge Clearance. Clearance stays in
-- confidentiality_level / visibility and is untouched here.
--
-- Do not apply to linked production without review.

INSERT INTO public.permissions (key, label)
VALUES
  ('ai.use', 'AIを使う'),
  ('expense.submit', '経費を申請する'),
  ('expense.view_own', '自分の経費を見る'),
  ('expense.manage', '経費を管理する'),
  ('sales.view_own', '自分の売上を見る'),
  ('sales.manage', '売上を管理する'),
  ('weekly_pay.submit', '週払いを申請する'),
  ('weekly_pay.manage', '週払いを管理する'),
  ('chat.use', '社内チャットを使う'),
  ('meeting.use', '議事録を使う'),
  ('meeting.manage', '議事録を管理する'),
  ('coding.use', 'コーディングを使う'),
  ('coding.local_agent', 'ローカル端末連携を使う'),
  ('tasks.use', 'タスクを使う'),
  ('mypage.use', 'マイページを使う'),
  ('admin.access', '管理センターを開く'),
  ('admin.staff_manage', 'スタッフを管理する'),
  ('admin.role_manage', 'ロールと権限を管理する')
ON CONFLICT (key) DO NOTHING;

-- Composable platform role templates (org_id IS NULL, like the existing ones).
-- Roles are named permission bundles: assign several rather than inventing a
-- role per job title. Employment type is deliberately absent from every name.
INSERT INTO public.roles (org_id, key, label)
VALUES
  (NULL, 'platform_base', '基本利用'),
  (NULL, 'platform_ai_user', 'AI利用'),
  (NULL, 'platform_coding_user', 'コーディング利用'),
  (NULL, 'platform_expense_submitter', '経費申請'),
  (NULL, 'platform_expense_manager', '経費管理'),
  (NULL, 'platform_sales_viewer', '売上参照'),
  (NULL, 'platform_sales_manager', '売上管理'),
  (NULL, 'platform_weekly_pay_submitter', '週払い申請'),
  (NULL, 'platform_weekly_pay_manager', '週払い管理'),
  (NULL, 'platform_chat_user', '社内チャット利用'),
  (NULL, 'platform_meeting_user', '議事録利用'),
  (NULL, 'platform_meeting_manager', '議事録管理'),
  (NULL, 'platform_admin', '統合アプリ管理')
ON CONFLICT (org_id, key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.regapro_seed_platform_role(
  p_role_key text,
  p_permission_keys text[]
)
RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM public.roles r
  JOIN public.permissions p ON p.key = ANY (p_permission_keys)
  WHERE r.org_id IS NULL AND r.key = p_role_key
  ON CONFLICT (role_id, permission_id) DO NOTHING;
$$;

SELECT public.regapro_seed_platform_role('platform_base', ARRAY['mypage.use', 'tasks.use']);
SELECT public.regapro_seed_platform_role('platform_ai_user', ARRAY['ai.use']);
SELECT public.regapro_seed_platform_role('platform_coding_user', ARRAY['coding.use', 'coding.local_agent']);
SELECT public.regapro_seed_platform_role('platform_expense_submitter', ARRAY['expense.submit', 'expense.view_own']);
SELECT public.regapro_seed_platform_role('platform_expense_manager', ARRAY['expense.submit', 'expense.view_own', 'expense.manage']);
SELECT public.regapro_seed_platform_role('platform_sales_viewer', ARRAY['sales.view_own']);
SELECT public.regapro_seed_platform_role('platform_sales_manager', ARRAY['sales.view_own', 'sales.manage']);
SELECT public.regapro_seed_platform_role('platform_weekly_pay_submitter', ARRAY['weekly_pay.submit']);
SELECT public.regapro_seed_platform_role('platform_weekly_pay_manager', ARRAY['weekly_pay.submit', 'weekly_pay.manage']);
SELECT public.regapro_seed_platform_role('platform_chat_user', ARRAY['chat.use']);
SELECT public.regapro_seed_platform_role('platform_meeting_user', ARRAY['meeting.use']);
SELECT public.regapro_seed_platform_role('platform_meeting_manager', ARRAY['meeting.use', 'meeting.manage']);
SELECT public.regapro_seed_platform_role(
  'platform_admin',
  ARRAY['admin.access', 'admin.staff_manage', 'admin.role_manage']
);

DROP FUNCTION public.regapro_seed_platform_role(text, text[]);

-- ---------------------------------------------------------------------------
-- Assignments and overrides
-- ---------------------------------------------------------------------------

CREATE TABLE public.staff_role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  staff_id uuid NOT NULL REFERENCES public.staff(staff_id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  -- Scope anchor: NULL for organization, else department/project/staff id.
  scope_type text NOT NULL DEFAULT 'organization'
    CHECK (scope_type IN ('organization', 'department', 'project', 'self')),
  scope_id uuid,
  granted_by_staff_id uuid REFERENCES public.staff(staff_id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT staff_role_assignments_scope_shape CHECK (
    (scope_type = 'organization' AND scope_id IS NULL)
    OR (scope_type IN ('department', 'project') AND scope_id IS NOT NULL)
    OR (scope_type = 'self' AND scope_id IS NULL)
  )
);
CREATE INDEX idx_staff_role_assignments_staff ON public.staff_role_assignments(staff_id, org_id);
CREATE UNIQUE INDEX uq_staff_role_assignment
  ON public.staff_role_assignments(
    staff_id,
    role_id,
    scope_type,
    COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE deleted_at IS NULL;

COMMENT ON TABLE public.staff_role_assignments IS
  'Feature Permission grants for the integrated app. Separate join path from membership_roles, which drives the legacy AI axis.';

CREATE TABLE public.staff_permission_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  staff_id uuid NOT NULL REFERENCES public.staff(staff_id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  -- deny always beats allow, including role grants at a covering scope.
  effect text NOT NULL CHECK (effect IN ('allow', 'deny')),
  scope_type text NOT NULL DEFAULT 'organization'
    CHECK (scope_type IN ('organization', 'department', 'project', 'self')),
  scope_id uuid,
  reason text,
  granted_by_staff_id uuid REFERENCES public.staff(staff_id),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT staff_permission_overrides_scope_shape CHECK (
    (scope_type = 'organization' AND scope_id IS NULL)
    OR (scope_type IN ('department', 'project') AND scope_id IS NOT NULL)
    OR (scope_type = 'self' AND scope_id IS NULL)
  )
);
CREATE INDEX idx_staff_permission_overrides_staff
  ON public.staff_permission_overrides(staff_id, org_id);
CREATE UNIQUE INDEX uq_staff_permission_override
  ON public.staff_permission_overrides(
    staff_id,
    permission_id,
    scope_type,
    COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE deleted_at IS NULL;

CREATE TABLE public.permission_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  actor_staff_id uuid REFERENCES public.staff(staff_id),
  actor_auth_user_id uuid REFERENCES auth.users(id),
  subject_staff_id uuid REFERENCES public.staff(staff_id),
  action text NOT NULL CHECK (action IN (
    'role_assigned', 'role_revoked',
    'override_granted', 'override_revoked',
    'staff_created', 'staff_status_changed',
    'identity_linked', 'identity_unlinked'
  )),
  before jsonb,
  after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_permission_audit_org ON public.permission_audit_events(org_id, created_at DESC);
CREATE INDEX idx_permission_audit_subject ON public.permission_audit_events(subject_staff_id);

COMMENT ON TABLE public.permission_audit_events IS
  'Append-only who/what/before/after for role and permission changes. No UPDATE or DELETE policy exists by design.';

-- ---------------------------------------------------------------------------
-- Permission evaluation helpers
-- ---------------------------------------------------------------------------

-- Mirrors packages/platform/src/rbac.ts: deny overrides win, then allow
-- overrides, then role grants. Expired and soft-deleted rows never count.
CREATE OR REPLACE FUNCTION public.regapro_staff_has_permission(
  p_org_id uuid,
  p_permission text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff_id uuid := public.regapro_current_staff_id();
BEGIN
  IF v_staff_id IS NULL THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.staff_permission_overrides spo
    JOIN public.permissions p ON p.id = spo.permission_id AND p.deleted_at IS NULL
    WHERE spo.staff_id = v_staff_id
      AND spo.org_id = p_org_id
      AND spo.deleted_at IS NULL
      AND spo.effect = 'deny'
      AND (spo.expires_at IS NULL OR spo.expires_at > now())
      AND p.key = p_permission
  ) THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.staff_permission_overrides spo
    JOIN public.permissions p ON p.id = spo.permission_id AND p.deleted_at IS NULL
    WHERE spo.staff_id = v_staff_id
      AND spo.org_id = p_org_id
      AND spo.deleted_at IS NULL
      AND spo.effect = 'allow'
      AND (spo.expires_at IS NULL OR spo.expires_at > now())
      AND p.key = p_permission
  ) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.staff_role_assignments sra
    JOIN public.roles r ON r.id = sra.role_id AND r.deleted_at IS NULL
    JOIN public.role_permissions rp ON rp.role_id = r.id AND rp.deleted_at IS NULL
    JOIN public.permissions p ON p.id = rp.permission_id AND p.deleted_at IS NULL
    WHERE sra.staff_id = v_staff_id
      AND sra.org_id = p_org_id
      AND sra.deleted_at IS NULL
      AND (sra.expires_at IS NULL OR sra.expires_at > now())
      AND p.key = p_permission
  );
END;
$$;

-- Management gates accept the legacy AI equivalent as well, so the existing
-- administrators keep working during backfill and there is no bootstrap
-- deadlock where nobody can grant the first platform_admin role.
-- Remove the legacy leg once every administrator holds a platform role.
CREATE OR REPLACE FUNCTION public.regapro_can_manage_staff(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.regapro_staff_has_permission(p_org_id, 'admin.staff_manage')
      OR public.regapro_has_permission(p_org_id, 'member:manage');
$$;

CREATE OR REPLACE FUNCTION public.regapro_can_manage_roles(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.regapro_staff_has_permission(p_org_id, 'admin.role_manage')
      OR public.regapro_has_permission(p_org_id, 'organization:manage');
$$;

-- Explicit grants: this project does not rely on default privileges.
-- DELETE is intentionally absent on permission_audit_events (append-only) and
-- on staff / staff_identities / staff_departments (people are marked left, not
-- deleted, so staff_no is never freed for reuse).
GRANT INSERT, UPDATE ON TABLE public.staff TO authenticated;
GRANT INSERT, UPDATE ON TABLE public.staff_identities TO authenticated;
GRANT INSERT, UPDATE ON TABLE public.staff_departments TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.staff_role_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.staff_permission_overrides TO authenticated;
GRANT SELECT, INSERT ON TABLE public.permission_audit_events TO authenticated;

GRANT ALL ON TABLE public.staff_role_assignments TO service_role;
GRANT ALL ON TABLE public.staff_permission_overrides TO service_role;
GRANT ALL ON TABLE public.permission_audit_events TO service_role;

REVOKE ALL ON FUNCTION public.regapro_staff_has_permission(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_can_manage_staff(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_can_manage_roles(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.regapro_staff_has_permission(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.regapro_can_manage_staff(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.regapro_can_manage_roles(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.regapro_staff_has_permission(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.regapro_can_manage_staff(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.regapro_can_manage_roles(uuid) TO service_role;

ALTER TABLE public.staff_role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_permission_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permission_audit_events ENABLE ROW LEVEL SECURITY;

-- Callers may inspect their own grants; changing anyone's grants (including
-- their own) requires the role management permission.
CREATE POLICY staff_role_assignments_select ON public.staff_role_assignments
  FOR SELECT USING (
    staff_id = public.regapro_current_staff_id()
    OR public.regapro_can_manage_roles(org_id)
  );
CREATE POLICY staff_role_assignments_insert ON public.staff_role_assignments
  FOR INSERT WITH CHECK (public.regapro_can_manage_roles(org_id));
CREATE POLICY staff_role_assignments_update ON public.staff_role_assignments
  FOR UPDATE USING (public.regapro_can_manage_roles(org_id))
  WITH CHECK (public.regapro_can_manage_roles(org_id));
CREATE POLICY staff_role_assignments_delete ON public.staff_role_assignments
  FOR DELETE USING (public.regapro_can_manage_roles(org_id));

CREATE POLICY staff_permission_overrides_select ON public.staff_permission_overrides
  FOR SELECT USING (
    staff_id = public.regapro_current_staff_id()
    OR public.regapro_can_manage_roles(org_id)
  );
CREATE POLICY staff_permission_overrides_insert ON public.staff_permission_overrides
  FOR INSERT WITH CHECK (public.regapro_can_manage_roles(org_id));
CREATE POLICY staff_permission_overrides_update ON public.staff_permission_overrides
  FOR UPDATE USING (public.regapro_can_manage_roles(org_id))
  WITH CHECK (public.regapro_can_manage_roles(org_id));
CREATE POLICY staff_permission_overrides_delete ON public.staff_permission_overrides
  FOR DELETE USING (public.regapro_can_manage_roles(org_id));

CREATE POLICY permission_audit_select ON public.permission_audit_events
  FOR SELECT USING (
    public.regapro_can_manage_roles(org_id)
    OR public.regapro_has_permission(org_id, 'audit:read')
  );
CREATE POLICY permission_audit_insert ON public.permission_audit_events
  FOR INSERT WITH CHECK (
    public.regapro_can_manage_roles(org_id)
    OR public.regapro_can_manage_staff(org_id)
  );

-- Staff write policies live here because they depend on the management
-- permissions defined above.
CREATE POLICY staff_insert ON public.staff
  FOR INSERT WITH CHECK (public.regapro_can_manage_staff(org_id));
CREATE POLICY staff_update ON public.staff
  FOR UPDATE USING (public.regapro_can_manage_staff(org_id))
  WITH CHECK (public.regapro_can_manage_staff(org_id));

CREATE POLICY staff_identities_select_manage ON public.staff_identities
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.staff_id = staff_identities.staff_id
        AND public.regapro_can_manage_staff(s.org_id)
    )
  );
CREATE POLICY staff_identities_write ON public.staff_identities
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.staff_id = staff_identities.staff_id
        AND public.regapro_can_manage_staff(s.org_id)
    )
  );
CREATE POLICY staff_identities_update ON public.staff_identities
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.staff_id = staff_identities.staff_id
        AND public.regapro_can_manage_staff(s.org_id)
    )
  );

CREATE POLICY staff_departments_write ON public.staff_departments
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.staff_id = staff_departments.staff_id
        AND public.regapro_can_manage_staff(s.org_id)
    )
  );
CREATE POLICY staff_departments_update ON public.staff_departments
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.staff_id = staff_departments.staff_id
        AND public.regapro_can_manage_staff(s.org_id)
    )
  );
