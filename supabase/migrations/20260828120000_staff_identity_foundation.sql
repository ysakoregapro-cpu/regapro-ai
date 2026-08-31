-- Integrated App Foundation v1 — Phase 1: canonical Staff identity.
--
-- Purely additive. Nothing here rewrites auth.users, organization_memberships,
-- profiles, or any existing AI table. auth.users.id remains the LOGIN identity;
-- staff.staff_id becomes the canonical PERSON identity, and staff_identities is
-- the only bridge between them. The two ids are never assumed equal.
--
-- Do not apply to linked production without review.

CREATE TABLE public.staff (
  staff_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  -- Human-readable identity. Displayed to people; never used as a foreign key.
  staff_no text NOT NULL,
  name text NOT NULL,
  -- Contractual relationship only. Never an input to permission decisions.
  employment_type text NOT NULL
    CHECK (employment_type IN ('executive', 'employee', 'part_time')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'left')),
  joined_at date,
  left_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Intentionally NOT partial: left staff keep their number so it is never reused.
  UNIQUE (org_id, staff_no)
);
CREATE INDEX idx_staff_org_status ON public.staff(org_id, status);

COMMENT ON TABLE public.staff IS
  'Canonical person identity for the integrated app. staff_id is the FK target; staff_no is display-only and never reused.';
COMMENT ON COLUMN public.staff.employment_type IS
  'Contract type only. Feature access comes from staff_role_assignments — never from this column.';

CREATE TABLE public.staff_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff(staff_id) ON DELETE CASCADE,
  identity_type text NOT NULL
    CHECK (identity_type IN ('app_auth', 'legacy_user', 'service_account', 'external_directory')),
  -- Free text so future systems onboard without a migration.
  source_system text NOT NULL,
  external_user_id text NOT NULL,
  -- Set only for identity_type = 'app_auth'.
  auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_system, external_user_id)
);
CREATE INDEX idx_staff_identities_staff ON public.staff_identities(staff_id);
CREATE INDEX idx_staff_identities_auth_user ON public.staff_identities(auth_user_id);

-- One login may map to at most one staff member.
CREATE UNIQUE INDEX uq_staff_identities_app_auth_user
  ON public.staff_identities(auth_user_id)
  WHERE auth_user_id IS NOT NULL AND identity_type = 'app_auth';

COMMENT ON TABLE public.staff_identities IS
  'Maps login and legacy system identities onto staff_id. Legacy auth.users.id values are NOT assumed to match current ones.';

CREATE TABLE public.staff_departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff(staff_id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  -- Job title is organisational information, not a permission input.
  job_title text,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (staff_id, department_id)
);
CREATE INDEX idx_staff_departments_dept ON public.staff_departments(department_id);
CREATE UNIQUE INDEX uq_staff_primary_department
  ON public.staff_departments(staff_id)
  WHERE is_primary AND deleted_at IS NULL;

COMMENT ON TABLE public.staff_departments IS
  'Organisational placement. job_title is descriptive only — permissions live in staff_role_assignments.';

-- ---------------------------------------------------------------------------
-- Identity resolution helpers
-- ---------------------------------------------------------------------------

-- Login identity -> canonical person. NULL when unmapped or not active, which
-- is what puts a caller into compatibility mode instead of granting anything.
CREATE OR REPLACE FUNCTION public.regapro_current_staff_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT si.staff_id
  FROM public.staff_identities si
  JOIN public.staff s ON s.staff_id = si.staff_id
  WHERE si.auth_user_id = auth.uid()
    AND si.identity_type = 'app_auth'
    AND s.status = 'active'
  ORDER BY si.created_at
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.regapro_staff_belongs_to_org(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.staff s
    WHERE s.staff_id = public.regapro_current_staff_id()
      AND s.org_id = p_org_id
      AND s.status = 'active'
  );
$$;

-- Org readership for the integrated app: an AI membership OR a staff record.
-- Part-time staff who only use business modules have no AI membership.
CREATE OR REPLACE FUNCTION public.regapro_can_read_org(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.regapro_is_org_member(p_org_id)
      OR public.regapro_staff_belongs_to_org(p_org_id);
$$;

COMMENT ON FUNCTION public.regapro_current_staff_id() IS
  'auth.uid() -> staff_id via staff_identities. Returns NULL for suspended/left staff so they hold no platform permissions.';

-- This project does not rely on default privileges: every table needs explicit
-- grants or RLS never gets a chance to run. Writes are granted in the RBAC
-- migration, alongside the policies that gate them.
GRANT SELECT ON TABLE public.staff TO authenticated;
GRANT SELECT ON TABLE public.staff_identities TO authenticated;
GRANT SELECT ON TABLE public.staff_departments TO authenticated;

GRANT ALL ON TABLE public.staff TO service_role;
GRANT ALL ON TABLE public.staff_identities TO service_role;
GRANT ALL ON TABLE public.staff_departments TO service_role;

REVOKE ALL ON FUNCTION public.regapro_current_staff_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_staff_belongs_to_org(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_can_read_org(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.regapro_current_staff_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.regapro_staff_belongs_to_org(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.regapro_can_read_org(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.regapro_current_staff_id() TO service_role;
GRANT EXECUTE ON FUNCTION public.regapro_staff_belongs_to_org(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.regapro_can_read_org(uuid) TO service_role;

ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_departments ENABLE ROW LEVEL SECURITY;

-- Directory read is org-scoped. Writes are gated in the RBAC migration, which
-- defines the management permissions; until then only service_role may write.
CREATE POLICY staff_select ON public.staff
  FOR SELECT USING (public.regapro_can_read_org(org_id));

-- Identity rows expose the legacy-system mapping, so they are self-read only
-- until an explicit management permission exists.
CREATE POLICY staff_identities_select_self ON public.staff_identities
  FOR SELECT USING (staff_id = public.regapro_current_staff_id());

CREATE POLICY staff_departments_select ON public.staff_departments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.staff_id = staff_departments.staff_id
        AND public.regapro_can_read_org(s.org_id)
    )
  );
