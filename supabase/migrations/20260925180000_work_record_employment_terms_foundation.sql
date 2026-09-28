-- Phase 3: Integrated Work Record / Employment Terms Foundation.
-- Work Record = actual hours. Employment Term = historical hourly wage.
-- Shift remains planned work and is never payroll / actual-hours SoT.
-- Weekly Pay / bank / payment / worker-settings tables are intentionally absent.
-- Forward-only. Do not apply to a linked project without review.

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

SET search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Permissions / role templates
-- ---------------------------------------------------------------------------

INSERT INTO public.permissions (key, label)
VALUES
  ('work_record.view_own', '自分の勤務実績を見る'),
  ('work_record.submit', '自分の勤務実績を提出する'),
  ('work_record.manage', '勤務実績を管理する'),
  ('employment_terms.manage', '時給条件を管理する')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.roles (org_id, key, label)
SELECT NULL, v.key, v.label
FROM (
  VALUES
    ('platform_work_record_user', '勤務実績利用'),
    ('platform_work_record_manager', '勤務実績管理'),
    ('platform_employment_terms_manager', '時給条件管理')
) AS v(key, label)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.roles r
  WHERE r.org_id IS NULL
    AND r.key = v.key
    AND r.deleted_at IS NULL
);

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
  JOIN public.permissions p
    ON p.key = ANY (p_permission_keys)
   AND p.deleted_at IS NULL
  WHERE r.org_id IS NULL
    AND r.key = p_role_key
    AND r.deleted_at IS NULL
  ON CONFLICT (role_id, permission_id) DO NOTHING;
$$;

SELECT public.regapro_seed_platform_role(
  'platform_work_record_user',
  ARRAY['work_record.view_own', 'work_record.submit']
);
SELECT public.regapro_seed_platform_role(
  'platform_work_record_manager',
  ARRAY['work_record.manage']
);
SELECT public.regapro_seed_platform_role(
  'platform_employment_terms_manager',
  ARRAY['employment_terms.manage']
);
SELECT public.regapro_seed_platform_role(
  'platform_admin',
  ARRAY[
    'work_record.view_own',
    'work_record.submit',
    'work_record.manage',
    'employment_terms.manage'
  ]
);

DROP FUNCTION public.regapro_seed_platform_role(text, text[]);

-- ---------------------------------------------------------------------------
-- employment_terms
-- ---------------------------------------------------------------------------

CREATE TABLE public.employment_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  staff_id uuid NOT NULL REFERENCES public.staff(staff_id),
  hourly_wage_yen integer NOT NULL CHECK (hourly_wage_yen > 0),
  effective_from date NOT NULL,
  effective_to date,
  created_by_staff_id uuid NOT NULL REFERENCES public.staff(staff_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by_staff_id uuid REFERENCES public.staff(staff_id),
  revoke_reason text,
  active_range daterange GENERATED ALWAYS AS (
    daterange(
      effective_from,
      COALESCE(effective_to + 1, 'infinity'::date),
      '[)'
    )
  ) STORED,
  CONSTRAINT employment_terms_inclusive_range CHECK (
    effective_to IS NULL OR effective_to >= effective_from
  ),
  CONSTRAINT employment_terms_revoke_shape CHECK (
    (revoked_at IS NULL AND revoked_by_staff_id IS NULL AND revoke_reason IS NULL)
    OR (revoked_at IS NOT NULL AND revoked_by_staff_id IS NOT NULL AND revoke_reason IS NOT NULL)
  ),
  EXCLUDE USING gist (
    staff_id WITH =,
    active_range WITH &&
  ) WHERE (revoked_at IS NULL)
);

CREATE INDEX idx_employment_terms_org_staff_from
  ON public.employment_terms (org_id, staff_id, effective_from);

COMMENT ON TABLE public.employment_terms IS
  'Versioned hourly-wage history for a staff member. Inclusive effective dates. Never rewrite past wages; close + insert or revoke.';
COMMENT ON COLUMN public.employment_terms.effective_to IS
  'Inclusive end date. NULL means open-ended.';
COMMENT ON COLUMN public.employment_terms.active_range IS
  'Half-open [effective_from, effective_to+1) used only for overlap exclusion. Open-ended uses infinity.';
COMMENT ON COLUMN public.employment_terms.hourly_wage_yen IS
  'Payroll-sensitive. Do not expose other staff wages to ordinary staff or AI context.';

-- ---------------------------------------------------------------------------
-- work_records
-- ---------------------------------------------------------------------------

CREATE TABLE public.work_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  staff_id uuid NOT NULL REFERENCES public.staff(staff_id),
  work_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  end_day_offset smallint NOT NULL DEFAULT 0 CHECK (end_day_offset IN (0, 1)),
  break_minutes integer NOT NULL DEFAULT 0 CHECK (break_minutes >= 0),
  worked_minutes integer GENERATED ALWAYS AS (
    (
      EXTRACT(EPOCH FROM (
        ((work_date + end_time) + make_interval(days => end_day_offset::integer))
        - (work_date + start_time)
      )) / 60
    )::integer - break_minutes
  ) STORED,
  transport_fee_yen integer NOT NULL DEFAULT 0 CHECK (transport_fee_yen >= 0),
  work_location_id uuid REFERENCES public.work_locations(id),
  source_shift_id uuid REFERENCES public.shifts(id),
  assignment_source text,
  assignment_external_ref text,
  status text NOT NULL CHECK (status IN ('draft', 'confirmed', 'locked', 'voided')),
  employment_term_id uuid REFERENCES public.employment_terms(id),
  hourly_wage_snapshot_yen integer CHECK (
    hourly_wage_snapshot_yen IS NULL OR hourly_wage_snapshot_yen > 0
  ),
  confirmed_at timestamptz,
  confirmed_by_staff_id uuid REFERENCES public.staff(staff_id),
  voided_at timestamptz,
  voided_by_staff_id uuid REFERENCES public.staff(staff_id),
  void_reason text,
  created_by_staff_id uuid NOT NULL REFERENCES public.staff(staff_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  work_range tstzrange GENERATED ALWAYS AS (
    tstzrange(
      (work_date + start_time) AT TIME ZONE 'Asia/Tokyo',
      ((work_date + end_time) + make_interval(days => end_day_offset::integer))
        AT TIME ZONE 'Asia/Tokyo',
      '[)'
    )
  ) STORED,
  CONSTRAINT work_records_schedule CHECK (
    (
      end_day_offset = 0
      AND end_time > start_time
    )
    OR end_day_offset = 1
  ),
  CONSTRAINT work_records_worked_positive CHECK (worked_minutes > 0),
  CONSTRAINT work_records_assignment_source CHECK (
    assignment_source IS NULL
    OR assignment_source ~ '^[A-Za-z0-9][A-Za-z0-9:_./!-]{0,199}$'
  ),
  CONSTRAINT work_records_assignment_ref CHECK (
    assignment_external_ref IS NULL
    OR assignment_external_ref ~ '^[A-Za-z0-9][A-Za-z0-9:_./!-]{0,199}$'
  ),
  CONSTRAINT work_records_lifecycle_shape CHECK (
    (
      status = 'draft'
      AND confirmed_at IS NULL
      AND confirmed_by_staff_id IS NULL
      AND voided_at IS NULL
      AND voided_by_staff_id IS NULL
      AND void_reason IS NULL
      AND employment_term_id IS NULL
      AND hourly_wage_snapshot_yen IS NULL
    )
    OR (
      status = 'confirmed'
      AND confirmed_at IS NOT NULL
      AND confirmed_by_staff_id IS NOT NULL
      AND voided_at IS NULL
      AND voided_by_staff_id IS NULL
      AND void_reason IS NULL
    )
    OR (
      status = 'locked'
      AND confirmed_at IS NOT NULL
      AND confirmed_by_staff_id IS NOT NULL
      AND voided_at IS NULL
      AND voided_by_staff_id IS NULL
      AND void_reason IS NULL
    )
    OR (
      status = 'voided'
      AND voided_at IS NOT NULL
      AND voided_by_staff_id IS NOT NULL
      AND void_reason IS NOT NULL
    )
  ),
  CONSTRAINT work_records_wage_pair CHECK (
    (employment_term_id IS NULL AND hourly_wage_snapshot_yen IS NULL)
    OR (employment_term_id IS NOT NULL AND hourly_wage_snapshot_yen IS NOT NULL)
  ),
  EXCLUDE USING gist (
    staff_id WITH =,
    work_range WITH &&
  ) WHERE (status <> 'voided')
);

CREATE INDEX idx_work_records_org_staff_date
  ON public.work_records (org_id, staff_id, work_date);
CREATE INDEX idx_work_records_org_status_date
  ON public.work_records (org_id, status, work_date);

COMMENT ON TABLE public.work_records IS
  'Canonical actual-hours record. Multiple rows per staff/day are allowed. Shift may prefill a draft but is never SoT. Wage snapshot is auxiliary history, not a Weekly Pay payment policy.';
COMMENT ON COLUMN public.work_records.worked_minutes IS
  'Derived: ((end datetime - start datetime) in minutes) - break_minutes. Same formula as packages/work.';
COMMENT ON COLUMN public.work_records.hourly_wage_snapshot_yen IS
  'Optional confirm-time snapshot. Salaried staff may confirm with NULL. Not Weekly Pay SoT.';
COMMENT ON COLUMN public.work_records.source_shift_id IS
  'Optional prefill source. Same org/staff/date required. Times remain independently editable.';
COMMENT ON COLUMN public.work_records.assignment_external_ref IS
  'Stable adapter key for a future Axis/Sales connection. Never a person name.';

-- ---------------------------------------------------------------------------
-- work_record_revisions
-- ---------------------------------------------------------------------------

CREATE TABLE public.work_record_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  work_record_id uuid NOT NULL REFERENCES public.work_records(id) ON DELETE RESTRICT,
  revision_no integer NOT NULL CHECK (revision_no >= 1),
  event_type text NOT NULL CHECK (
    event_type IN ('created', 'updated', 'confirmed', 'reopened', 'voided')
  ),
  actor_staff_id uuid NOT NULL REFERENCES public.staff(staff_id),
  before_snapshot jsonb,
  after_snapshot jsonb NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_record_id, revision_no)
);

CREATE INDEX idx_work_record_revisions_org_record
  ON public.work_record_revisions (org_id, work_record_id, revision_no);

COMMENT ON TABLE public.work_record_revisions IS
  'Append-only domain history of Work Record content. Distinct from generic audit_logs. Parent delete is RESTRICT so history is not cascaded away.';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.regapro_work_rpc_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT current_setting('regapro.work_rpc', true) = '1';
$$;

CREATE OR REPLACE FUNCTION public.regapro_has_any_work_record_permission(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.regapro_staff_has_permission(p_org_id, 'work_record.view_own')
      OR public.regapro_staff_has_permission(p_org_id, 'work_record.submit')
      OR public.regapro_staff_has_permission(p_org_id, 'work_record.manage');
$$;

CREATE OR REPLACE FUNCTION public.regapro_write_work_audit(
  p_org_id uuid,
  p_action text,
  p_resource_type text,
  p_resource_id uuid,
  p_actor_staff_id uuid,
  p_subject_staff_id uuid,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(p_metadata, '{}'::jsonb) ? 'hourly_wage_yen'
    OR COALESCE(p_metadata, '{}'::jsonb) ? 'hourly_wage_snapshot_yen' THEN
    RAISE EXCEPTION 'WORK_FORBIDDEN: hourly wage must not be written to audit metadata'
      USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.audit_logs (
    org_id,
    actor_id,
    actor_staff_id,
    subject_staff_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) VALUES (
    p_org_id,
    auth.uid(),
    p_actor_staff_id,
    p_subject_staff_id,
    p_action,
    p_resource_type,
    p_resource_id,
    COALESCE(p_metadata, '{}'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.regapro_work_record_snapshot(p_row public.work_records)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT to_jsonb(p_row) - 'work_range';
$$;

CREATE OR REPLACE FUNCTION public.regapro_append_work_record_revision(
  p_row public.work_records,
  p_event text,
  p_actor uuid,
  p_before jsonb,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_no integer;
BEGIN
  SELECT COALESCE(MAX(revision_no), 0) + 1
    INTO v_no
  FROM public.work_record_revisions
  WHERE work_record_id = p_row.id;

  INSERT INTO public.work_record_revisions (
    org_id,
    work_record_id,
    revision_no,
    event_type,
    actor_staff_id,
    before_snapshot,
    after_snapshot,
    reason
  ) VALUES (
    p_row.org_id,
    p_row.id,
    v_no,
    p_event,
    p_actor,
    p_before,
    public.regapro_work_record_snapshot(p_row),
    p_reason
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.regapro_assert_staff_same_org(
  p_org_id uuid,
  p_staff_id uuid,
  p_label text
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
BEGIN
  SELECT org_id INTO v_org
  FROM public.staff
  WHERE staff_id = p_staff_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WORK_NOT_FOUND: %', p_label;
  END IF;
  IF v_org IS DISTINCT FROM p_org_id THEN
    RAISE EXCEPTION 'WORK_CROSS_ORG: % must belong to the same org', p_label;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.regapro_assert_staff_same_org(uuid, uuid, text) IS
  'Same-org integrity only. Does not inspect staff.status. Historical created_by / confirmed_by / voided_by / revoked_by / revision actors may later become suspended or left. Active callers are gated by regapro_current_staff_id(); new-target active rules stay in RPCs.';

CREATE OR REPLACE FUNCTION public.regapro_lock_employment_term_scope(
  p_org_id uuid,
  p_staff_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_org_id::text || ':term:' || p_staff_id::text, 331877)
  );
END;
$$;

COMMENT ON FUNCTION public.regapro_lock_employment_term_scope(uuid, uuid) IS
  'Canonical org+staff advisory xact lock for employment term lifecycle and Work Record wage snapshot. Order: unlocked org/staff read, this scope, then SELECT FOR UPDATE, then revalidate, then mutate/snapshot.';

CREATE OR REPLACE FUNCTION public.regapro_employment_term_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.regapro_assert_staff_same_org(NEW.org_id, NEW.staff_id, 'staff_id');
  PERFORM public.regapro_assert_staff_same_org(NEW.org_id, NEW.created_by_staff_id, 'created_by_staff_id');
  IF NEW.revoked_by_staff_id IS NOT NULL THEN
    PERFORM public.regapro_assert_staff_same_org(NEW.org_id, NEW.revoked_by_staff_id, 'revoked_by_staff_id');
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.org_id IS DISTINCT FROM OLD.org_id
      OR NEW.staff_id IS DISTINCT FROM OLD.staff_id
      OR NEW.hourly_wage_yen IS DISTINCT FROM OLD.hourly_wage_yen
      OR NEW.effective_from IS DISTINCT FROM OLD.effective_from THEN
      IF NOT public.regapro_work_rpc_active() THEN
        RAISE EXCEPTION 'WORK_RECORD_IMMUTABLE: employment term history cannot be rewritten';
      END IF;
      IF NEW.hourly_wage_yen IS DISTINCT FROM OLD.hourly_wage_yen THEN
        RAISE EXCEPTION 'WORK_RECORD_IMMUTABLE: hourly wage cannot be rewritten; close and insert';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_employment_terms_integrity
  BEFORE INSERT OR UPDATE ON public.employment_terms
  FOR EACH ROW EXECUTE FUNCTION public.regapro_employment_term_integrity();

CREATE TRIGGER trg_employment_terms_updated_at
  BEFORE UPDATE ON public.employment_terms
  FOR EACH ROW EXECUTE FUNCTION public.regapro_touch_updated_at();

CREATE OR REPLACE FUNCTION public.regapro_employment_term_mutation_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.regapro_work_rpc_active() THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'WORK_RECORD_IMMUTABLE: employment term mutations must go through RPC';
END;
$$;

CREATE TRIGGER trg_employment_terms_mutation_guard
  BEFORE UPDATE ON public.employment_terms
  FOR EACH ROW EXECUTE FUNCTION public.regapro_employment_term_mutation_guard();

CREATE OR REPLACE FUNCTION public.regapro_work_record_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift public.shifts;
  v_term public.employment_terms;
BEGIN
  PERFORM public.regapro_assert_staff_same_org(NEW.org_id, NEW.staff_id, 'staff_id');
  PERFORM public.regapro_assert_staff_same_org(NEW.org_id, NEW.created_by_staff_id, 'created_by_staff_id');
  IF NEW.confirmed_by_staff_id IS NOT NULL THEN
    PERFORM public.regapro_assert_staff_same_org(NEW.org_id, NEW.confirmed_by_staff_id, 'confirmed_by_staff_id');
  END IF;
  IF NEW.voided_by_staff_id IS NOT NULL THEN
    PERFORM public.regapro_assert_staff_same_org(NEW.org_id, NEW.voided_by_staff_id, 'voided_by_staff_id');
  END IF;

  IF NEW.work_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.work_locations wl
    WHERE wl.id = NEW.work_location_id
      AND wl.org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION 'WORK_CROSS_ORG: work_location_id must belong to the same org';
  END IF;

  IF NEW.source_shift_id IS NOT NULL THEN
    SELECT * INTO v_shift FROM public.shifts WHERE id = NEW.source_shift_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'WORK_NOT_FOUND: source shift';
    END IF;
    IF v_shift.org_id IS DISTINCT FROM NEW.org_id
      OR v_shift.staff_id IS DISTINCT FROM NEW.staff_id
      OR v_shift.work_date IS DISTINCT FROM NEW.work_date THEN
      RAISE EXCEPTION 'WORK_CROSS_ORG: source_shift_id must match org, staff, and work_date';
    END IF;
  END IF;

  IF NEW.employment_term_id IS NOT NULL THEN
    SELECT * INTO v_term FROM public.employment_terms WHERE id = NEW.employment_term_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'WORK_NOT_FOUND: employment term';
    END IF;
    IF v_term.org_id IS DISTINCT FROM NEW.org_id
      OR v_term.staff_id IS DISTINCT FROM NEW.staff_id THEN
      RAISE EXCEPTION 'WORK_CROSS_ORG: employment_term_id must match org and staff';
    END IF;
    IF NEW.work_date < v_term.effective_from
      OR (v_term.effective_to IS NOT NULL AND NEW.work_date > v_term.effective_to) THEN
      RAISE EXCEPTION 'WORK_INVALID_TERM_RANGE: work_date is outside the employment term';
    END IF;
    IF NEW.hourly_wage_snapshot_yen IS DISTINCT FROM v_term.hourly_wage_yen THEN
      RAISE EXCEPTION 'WORK_INVALID_WAGE: hourly_wage_snapshot_yen must match the term';
    END IF;
    IF v_term.revoked_at IS NOT NULL
      AND (NEW.confirmed_at IS NULL OR NEW.confirmed_at >= v_term.revoked_at) THEN
      RAISE EXCEPTION 'WORK_TERM_REVOKED: cannot snapshot a revoked employment term';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.org_id IS DISTINCT FROM OLD.org_id
    OR NEW.staff_id IS DISTINCT FROM OLD.staff_id
  ) THEN
    RAISE EXCEPTION 'WORK_RECORD_IMMUTABLE: staff_id and org_id cannot change';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_work_records_integrity
  BEFORE INSERT OR UPDATE ON public.work_records
  FOR EACH ROW EXECUTE FUNCTION public.regapro_work_record_integrity();

CREATE TRIGGER trg_work_records_updated_at
  BEFORE UPDATE ON public.work_records
  FOR EACH ROW EXECUTE FUNCTION public.regapro_touch_updated_at();

CREATE OR REPLACE FUNCTION public.regapro_work_record_mutation_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.regapro_work_rpc_active() THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'WORK_RECORD_IMMUTABLE: work record mutations must go through RPC';
END;
$$;

CREATE TRIGGER trg_work_records_mutation_guard
  BEFORE UPDATE ON public.work_records
  FOR EACH ROW EXECUTE FUNCTION public.regapro_work_record_mutation_guard();

CREATE OR REPLACE FUNCTION public.regapro_work_record_revision_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent public.work_records;
BEGIN
  SELECT * INTO v_parent FROM public.work_records WHERE id = NEW.work_record_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WORK_NOT_FOUND: parent work record';
  END IF;
  IF NEW.org_id IS DISTINCT FROM v_parent.org_id THEN
    RAISE EXCEPTION 'WORK_CROSS_ORG: revision org_id must match the parent work record';
  END IF;
  PERFORM public.regapro_assert_staff_same_org(NEW.org_id, NEW.actor_staff_id, 'actor_staff_id');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_work_record_revisions_integrity
  BEFORE INSERT OR UPDATE ON public.work_record_revisions
  FOR EACH ROW EXECUTE FUNCTION public.regapro_work_record_revision_integrity();

CREATE OR REPLACE FUNCTION public.regapro_work_record_revision_mutation_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'WORK_RECORD_IMMUTABLE: revisions are append-only';
  END IF;
  IF NOT public.regapro_work_rpc_active() THEN
    RAISE EXCEPTION 'WORK_RECORD_IMMUTABLE: revisions must be written by RPC';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_work_record_revisions_mutation_guard
  BEFORE INSERT OR UPDATE ON public.work_record_revisions
  FOR EACH ROW EXECUTE FUNCTION public.regapro_work_record_revision_mutation_guard();

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_employment_term(
  p_staff_id uuid,
  p_hourly_wage_yen integer,
  p_effective_from date,
  p_effective_to date DEFAULT NULL,
  p_close_open_ended boolean DEFAULT true
)
RETURNS public.employment_terms
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_org uuid;
  v_open public.employment_terms;
  v_term public.employment_terms;
  v_close_to date;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'WORK_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  SELECT s.org_id INTO v_org
  FROM public.staff s
  WHERE s.staff_id = v_actor AND s.status = 'active';
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'WORK_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  IF NOT public.regapro_staff_has_permission(v_org, 'employment_terms.manage') THEN
    RAISE EXCEPTION 'WORK_FORBIDDEN: employment_terms.manage required' USING ERRCODE = '42501';
  END IF;
  IF p_hourly_wage_yen IS NULL OR p_hourly_wage_yen <= 0 THEN
    RAISE EXCEPTION 'WORK_INVALID_WAGE: hourly_wage_yen must be greater than 0';
  END IF;
  IF p_effective_to IS NOT NULL AND p_effective_to < p_effective_from THEN
    RAISE EXCEPTION 'WORK_INVALID_TERM_RANGE: effective_to must be on or after effective_from';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.staff s
    WHERE s.staff_id = p_staff_id AND s.org_id = v_org AND s.status = 'active'
  ) THEN
    RAISE EXCEPTION 'WORK_NOT_FOUND: staff';
  END IF;

  -- Lock order: unlocked org/staff read → advisory scope → row FOR UPDATE → revalidate → mutate.
  PERFORM public.regapro_lock_employment_term_scope(v_org, p_staff_id);
  PERFORM set_config('regapro.work_rpc', '1', true);

  IF public.regapro_current_staff_id() IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'WORK_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  IF NOT public.regapro_staff_has_permission(v_org, 'employment_terms.manage') THEN
    RAISE EXCEPTION 'WORK_FORBIDDEN: employment_terms.manage required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.staff s
    WHERE s.staff_id = p_staff_id AND s.org_id = v_org AND s.status = 'active'
  ) THEN
    RAISE EXCEPTION 'WORK_NOT_FOUND: staff';
  END IF;

  IF p_close_open_ended THEN
    SELECT * INTO v_open
    FROM public.employment_terms
    WHERE org_id = v_org
      AND staff_id = p_staff_id
      AND revoked_at IS NULL
      AND effective_to IS NULL
    FOR UPDATE;
    IF FOUND THEN
      v_close_to := p_effective_from - 1;
      IF v_close_to < v_open.effective_from THEN
        RAISE EXCEPTION 'WORK_TERM_OVERLAP: cannot close an open-ended term before it starts';
      END IF;
      UPDATE public.employment_terms
        SET effective_to = v_close_to
      WHERE id = v_open.id;
    END IF;
  END IF;

  INSERT INTO public.employment_terms (
    org_id, staff_id, hourly_wage_yen, effective_from, effective_to, created_by_staff_id
  ) VALUES (
    v_org, p_staff_id, p_hourly_wage_yen, p_effective_from, p_effective_to, v_actor
  )
  RETURNING * INTO v_term;

  PERFORM public.regapro_write_work_audit(
    v_org,
    'employment_term_created',
    'employment_term',
    v_term.id,
    v_actor,
    p_staff_id,
    jsonb_build_object(
      'effective_from', p_effective_from,
      'effective_to', p_effective_to
    )
  );
  RETURN v_term;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_employment_term(
  p_term_id uuid,
  p_reason text
)
RETURNS public.employment_terms
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_peek public.employment_terms;
  v_term public.employment_terms;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'WORK_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'WORK_INVALID_REASON: reason is required';
  END IF;

  -- Lock order: unlocked term read → advisory scope → FOR UPDATE → revalidate → revoke.
  SELECT * INTO v_peek
  FROM public.employment_terms
  WHERE id = p_term_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WORK_NOT_FOUND: employment term';
  END IF;
  IF NOT public.regapro_staff_belongs_to_org(v_peek.org_id) THEN
    RAISE EXCEPTION 'WORK_FORBIDDEN: cross-org denied' USING ERRCODE = '42501';
  END IF;
  IF NOT public.regapro_staff_has_permission(v_peek.org_id, 'employment_terms.manage') THEN
    RAISE EXCEPTION 'WORK_FORBIDDEN: employment_terms.manage required' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('regapro.work_rpc', '1', true);
  PERFORM public.regapro_lock_employment_term_scope(v_peek.org_id, v_peek.staff_id);

  SELECT * INTO v_term
  FROM public.employment_terms
  WHERE id = p_term_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WORK_NOT_FOUND: employment term';
  END IF;
  IF v_term.org_id IS DISTINCT FROM v_peek.org_id
    OR v_term.staff_id IS DISTINCT FROM v_peek.staff_id THEN
    RAISE EXCEPTION 'WORK_CONFLICT: employment term identity changed during lock';
  END IF;
  IF NOT public.regapro_staff_belongs_to_org(v_term.org_id) THEN
    RAISE EXCEPTION 'WORK_FORBIDDEN: cross-org denied' USING ERRCODE = '42501';
  END IF;
  IF NOT public.regapro_staff_has_permission(v_term.org_id, 'employment_terms.manage') THEN
    RAISE EXCEPTION 'WORK_FORBIDDEN: employment_terms.manage required' USING ERRCODE = '42501';
  END IF;
  IF v_term.revoked_at IS NOT NULL THEN
    RETURN v_term;
  END IF;

  UPDATE public.employment_terms
    SET revoked_at = now(),
        revoked_by_staff_id = v_actor,
        revoke_reason = btrim(p_reason)
  WHERE id = v_term.id
  RETURNING * INTO v_term;

  PERFORM public.regapro_write_work_audit(
    v_term.org_id,
    'employment_term_revoked',
    'employment_term',
    v_term.id,
    v_actor,
    v_term.staff_id,
    jsonb_build_object('reason', btrim(p_reason))
  );
  RETURN v_term;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_or_update_work_record_draft(
  p_work_record_id uuid DEFAULT NULL,
  p_staff_id uuid DEFAULT NULL,
  p_work_date date DEFAULT NULL,
  p_start_time time DEFAULT NULL,
  p_end_time time DEFAULT NULL,
  p_end_day_offset smallint DEFAULT 0,
  p_break_minutes integer DEFAULT 0,
  p_transport_fee_yen integer DEFAULT 0,
  p_work_location_id uuid DEFAULT NULL,
  p_source_shift_id uuid DEFAULT NULL,
  p_assignment_source text DEFAULT NULL,
  p_assignment_external_ref text DEFAULT NULL
)
RETURNS public.work_records
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_org uuid;
  v_target uuid;
  v_rec public.work_records;
  v_before jsonb;
  v_event text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'WORK_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  SELECT s.org_id INTO v_org
  FROM public.staff s
  WHERE s.staff_id = v_actor AND s.status = 'active';
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'WORK_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  IF p_work_date IS NULL OR p_start_time IS NULL OR p_end_time IS NULL THEN
    RAISE EXCEPTION 'WORK_INVALID_SCHEDULE: work_date, start_time, and end_time are required';
  END IF;
  IF p_end_day_offset NOT IN (0, 1) THEN
    RAISE EXCEPTION 'WORK_INVALID_SCHEDULE: end_day_offset must be 0 or 1';
  END IF;
  IF p_break_minutes < 0 THEN
    RAISE EXCEPTION 'WORK_INVALID_BREAK: break_minutes must be >= 0';
  END IF;
  IF p_transport_fee_yen < 0 THEN
    RAISE EXCEPTION 'WORK_INVALID_TRANSPORT: transport_fee_yen must be >= 0';
  END IF;

  v_target := COALESCE(p_staff_id, v_actor);
  IF v_target <> v_actor AND NOT public.regapro_staff_has_permission(v_org, 'work_record.manage') THEN
    RAISE EXCEPTION 'WORK_FORBIDDEN: cannot create a work record for another staff' USING ERRCODE = '42501';
  END IF;
  IF v_target = v_actor AND NOT (
    public.regapro_staff_has_permission(v_org, 'work_record.submit')
    OR public.regapro_staff_has_permission(v_org, 'work_record.manage')
  ) THEN
    RAISE EXCEPTION 'WORK_FORBIDDEN: work_record.submit required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.staff s
    WHERE s.staff_id = v_target AND s.org_id = v_org AND s.status = 'active'
  ) THEN
    RAISE EXCEPTION 'WORK_NOT_FOUND: staff';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      v_org::text || ':wr:' || v_target::text || ':' || p_work_date::text,
      331877
    )
  );
  PERFORM set_config('regapro.work_rpc', '1', true);

  IF p_work_record_id IS NOT NULL THEN
    SELECT * INTO v_rec
    FROM public.work_records
    WHERE id = p_work_record_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'WORK_NOT_FOUND: work record';
    END IF;
    IF v_rec.org_id IS DISTINCT FROM v_org THEN
      RAISE EXCEPTION 'WORK_FORBIDDEN: cross-org denied' USING ERRCODE = '42501';
    END IF;
    IF v_rec.status = 'locked' THEN
      RAISE EXCEPTION 'WORK_LOCKED_IMMUTABLE: locked work records cannot be changed';
    END IF;
    IF v_rec.status <> 'draft' THEN
      RAISE EXCEPTION 'WORK_RECORD_IMMUTABLE: only draft work records may be edited';
    END IF;
    IF v_rec.staff_id <> v_actor
      AND NOT public.regapro_staff_has_permission(v_org, 'work_record.manage') THEN
      RAISE EXCEPTION 'WORK_FORBIDDEN: cannot edit another staff work record' USING ERRCODE = '42501';
    END IF;
    v_before := public.regapro_work_record_snapshot(v_rec);
    UPDATE public.work_records
      SET work_date = p_work_date,
          start_time = p_start_time,
          end_time = p_end_time,
          end_day_offset = p_end_day_offset,
          break_minutes = p_break_minutes,
          transport_fee_yen = p_transport_fee_yen,
          work_location_id = p_work_location_id,
          source_shift_id = p_source_shift_id,
          assignment_source = NULLIF(p_assignment_source, ''),
          assignment_external_ref = NULLIF(p_assignment_external_ref, '')
    WHERE id = v_rec.id
    RETURNING * INTO v_rec;
    v_event := 'updated';
  ELSE
    INSERT INTO public.work_records (
      org_id, staff_id, work_date, start_time, end_time, end_day_offset,
      break_minutes, transport_fee_yen, work_location_id, source_shift_id,
      assignment_source, assignment_external_ref, status, created_by_staff_id
    ) VALUES (
      v_org, v_target, p_work_date, p_start_time, p_end_time, p_end_day_offset,
      p_break_minutes, p_transport_fee_yen, p_work_location_id, p_source_shift_id,
      NULLIF(p_assignment_source, ''), NULLIF(p_assignment_external_ref, ''),
      'draft', v_actor
    )
    RETURNING * INTO v_rec;
    v_before := NULL;
    v_event := 'created';
  END IF;

  PERFORM public.regapro_append_work_record_revision(v_rec, v_event, v_actor, v_before, NULL);
  PERFORM public.regapro_write_work_audit(
    v_org,
    CASE WHEN v_event = 'created' THEN 'work_record_created' ELSE 'work_record_updated' END,
    'work_record',
    v_rec.id,
    v_actor,
    v_rec.staff_id,
    jsonb_build_object('status', v_rec.status, 'work_date', v_rec.work_date)
  );
  RETURN v_rec;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_work_record(p_work_record_id uuid)
RETURNS public.work_records
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_peek public.work_records;
  v_rec public.work_records;
  v_before jsonb;
  v_end timestamptz;
  v_term public.employment_terms;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'WORK_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;

  -- Lock order: unlocked Work Record read → term-scope advisory → FOR UPDATE → revalidate → term SELECT → snapshot.
  SELECT * INTO v_peek
  FROM public.work_records
  WHERE id = p_work_record_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WORK_NOT_FOUND: work record';
  END IF;
  IF NOT public.regapro_staff_belongs_to_org(v_peek.org_id) THEN
    RAISE EXCEPTION 'WORK_FORBIDDEN: cross-org denied' USING ERRCODE = '42501';
  END IF;

  PERFORM public.regapro_lock_employment_term_scope(v_peek.org_id, v_peek.staff_id);
  PERFORM set_config('regapro.work_rpc', '1', true);

  SELECT * INTO v_rec
  FROM public.work_records
  WHERE id = p_work_record_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WORK_NOT_FOUND: work record';
  END IF;
  IF v_rec.org_id IS DISTINCT FROM v_peek.org_id
    OR v_rec.staff_id IS DISTINCT FROM v_peek.staff_id THEN
    RAISE EXCEPTION 'WORK_CONFLICT: work record identity changed during lock';
  END IF;
  IF NOT public.regapro_staff_belongs_to_org(v_rec.org_id) THEN
    RAISE EXCEPTION 'WORK_FORBIDDEN: cross-org denied' USING ERRCODE = '42501';
  END IF;
  IF v_rec.status = 'confirmed' THEN
    RETURN v_rec;
  END IF;
  IF v_rec.status = 'locked' THEN
    RAISE EXCEPTION 'WORK_LOCKED_IMMUTABLE: locked work records cannot be confirmed';
  END IF;
  IF v_rec.status <> 'draft' THEN
    RAISE EXCEPTION 'WORK_INVALID_TRANSITION: cannot confirm a % work record', v_rec.status;
  END IF;
  IF v_rec.staff_id <> v_actor AND NOT public.regapro_staff_has_permission(v_rec.org_id, 'work_record.manage') THEN
    RAISE EXCEPTION 'WORK_FORBIDDEN: cannot confirm another staff work record' USING ERRCODE = '42501';
  END IF;
  IF v_rec.staff_id = v_actor AND NOT (
    public.regapro_staff_has_permission(v_rec.org_id, 'work_record.submit')
    OR public.regapro_staff_has_permission(v_rec.org_id, 'work_record.manage')
  ) THEN
    RAISE EXCEPTION 'WORK_FORBIDDEN: work_record.submit required' USING ERRCODE = '42501';
  END IF;

  v_end := (
    ((v_rec.work_date + v_rec.end_time) + make_interval(days => v_rec.end_day_offset::integer))
    AT TIME ZONE 'Asia/Tokyo'
  );
  IF v_end > now() THEN
    RAISE EXCEPTION 'WORK_FUTURE_CONFIRM: a future work record cannot be confirmed';
  END IF;

  SELECT * INTO v_term
  FROM public.employment_terms
  WHERE org_id = v_rec.org_id
    AND staff_id = v_rec.staff_id
    AND revoked_at IS NULL
    AND effective_from <= v_rec.work_date
    AND (effective_to IS NULL OR effective_to >= v_rec.work_date)
  ORDER BY effective_from DESC
  LIMIT 1;

  v_before := public.regapro_work_record_snapshot(v_rec);
  UPDATE public.work_records
    SET status = 'confirmed',
        confirmed_at = now(),
        confirmed_by_staff_id = v_actor,
        employment_term_id = v_term.id,
        hourly_wage_snapshot_yen = v_term.hourly_wage_yen
  WHERE id = v_rec.id
  RETURNING * INTO v_rec;

  PERFORM public.regapro_append_work_record_revision(v_rec, 'confirmed', v_actor, v_before, NULL);
  PERFORM public.regapro_write_work_audit(
    v_rec.org_id,
    'work_record_confirmed',
    'work_record',
    v_rec.id,
    v_actor,
    v_rec.staff_id,
    jsonb_build_object(
      'status', v_rec.status,
      'has_wage_snapshot', v_rec.employment_term_id IS NOT NULL
    )
  );
  RETURN v_rec;
END;
$$;

CREATE OR REPLACE FUNCTION public.reopen_work_record(
  p_work_record_id uuid,
  p_reason text
)
RETURNS public.work_records
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_rec public.work_records;
  v_before jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'WORK_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'WORK_INVALID_REASON: reason is required';
  END IF;
  PERFORM set_config('regapro.work_rpc', '1', true);

  SELECT * INTO v_rec
  FROM public.work_records
  WHERE id = p_work_record_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WORK_NOT_FOUND: work record';
  END IF;
  IF NOT public.regapro_staff_belongs_to_org(v_rec.org_id) THEN
    RAISE EXCEPTION 'WORK_FORBIDDEN: cross-org denied' USING ERRCODE = '42501';
  END IF;
  IF NOT public.regapro_staff_has_permission(v_rec.org_id, 'work_record.manage') THEN
    RAISE EXCEPTION 'WORK_FORBIDDEN: work_record.manage required to reopen' USING ERRCODE = '42501';
  END IF;
  IF v_rec.status = 'locked' THEN
    RAISE EXCEPTION 'WORK_LOCKED_IMMUTABLE: locked work records cannot be reopened';
  END IF;
  IF v_rec.status <> 'confirmed' THEN
    RAISE EXCEPTION 'WORK_INVALID_TRANSITION: cannot reopen a % work record', v_rec.status;
  END IF;

  v_before := public.regapro_work_record_snapshot(v_rec);
  UPDATE public.work_records
    SET status = 'draft',
        confirmed_at = NULL,
        confirmed_by_staff_id = NULL,
        employment_term_id = NULL,
        hourly_wage_snapshot_yen = NULL
  WHERE id = v_rec.id
  RETURNING * INTO v_rec;

  PERFORM public.regapro_append_work_record_revision(v_rec, 'reopened', v_actor, v_before, btrim(p_reason));
  PERFORM public.regapro_write_work_audit(
    v_rec.org_id,
    'work_record_reopened',
    'work_record',
    v_rec.id,
    v_actor,
    v_rec.staff_id,
    jsonb_build_object('reason', btrim(p_reason))
  );
  RETURN v_rec;
END;
$$;

CREATE OR REPLACE FUNCTION public.void_work_record(
  p_work_record_id uuid,
  p_reason text
)
RETURNS public.work_records
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_rec public.work_records;
  v_before jsonb;
  v_can_manage boolean;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'WORK_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'WORK_INVALID_REASON: reason is required';
  END IF;
  PERFORM set_config('regapro.work_rpc', '1', true);

  SELECT * INTO v_rec
  FROM public.work_records
  WHERE id = p_work_record_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WORK_NOT_FOUND: work record';
  END IF;
  IF NOT public.regapro_staff_belongs_to_org(v_rec.org_id) THEN
    RAISE EXCEPTION 'WORK_FORBIDDEN: cross-org denied' USING ERRCODE = '42501';
  END IF;
  v_can_manage := public.regapro_staff_has_permission(v_rec.org_id, 'work_record.manage');
  IF v_rec.status = 'voided' THEN
    RETURN v_rec;
  END IF;
  IF v_rec.status = 'locked' THEN
    RAISE EXCEPTION 'WORK_LOCKED_IMMUTABLE: locked work records cannot be voided';
  END IF;
  IF v_rec.status = 'draft' THEN
    IF v_rec.staff_id <> v_actor AND NOT v_can_manage THEN
      RAISE EXCEPTION 'WORK_FORBIDDEN: cannot void another staff work record' USING ERRCODE = '42501';
    END IF;
    IF v_rec.staff_id = v_actor AND NOT (
      public.regapro_staff_has_permission(v_rec.org_id, 'work_record.submit')
      OR v_can_manage
    ) THEN
      RAISE EXCEPTION 'WORK_FORBIDDEN: work_record.submit required' USING ERRCODE = '42501';
    END IF;
  ELSIF v_rec.status = 'confirmed' THEN
    IF NOT v_can_manage THEN
      RAISE EXCEPTION 'WORK_FORBIDDEN: work_record.manage required to void a confirmed record'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'WORK_INVALID_TRANSITION: cannot void a % work record', v_rec.status;
  END IF;

  v_before := public.regapro_work_record_snapshot(v_rec);
  UPDATE public.work_records
    SET status = 'voided',
        voided_at = now(),
        voided_by_staff_id = v_actor,
        void_reason = btrim(p_reason)
  WHERE id = v_rec.id
  RETURNING * INTO v_rec;

  PERFORM public.regapro_append_work_record_revision(v_rec, 'voided', v_actor, v_before, btrim(p_reason));
  PERFORM public.regapro_write_work_audit(
    v_rec.org_id,
    'work_record_voided',
    'work_record',
    v_rec.id,
    v_actor,
    v_rec.staff_id,
    jsonb_build_object('reason', btrim(p_reason))
  );
  RETURN v_rec;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

GRANT SELECT ON TABLE public.employment_terms TO authenticated;
GRANT SELECT ON TABLE public.work_records TO authenticated;
GRANT SELECT ON TABLE public.work_record_revisions TO authenticated;

GRANT ALL ON TABLE public.employment_terms TO service_role;
GRANT ALL ON TABLE public.work_records TO service_role;
GRANT ALL ON TABLE public.work_record_revisions TO service_role;

REVOKE ALL ON FUNCTION public.regapro_work_rpc_active() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_has_any_work_record_permission(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_write_work_audit(uuid, text, text, uuid, uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_work_record_snapshot(public.work_records) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_append_work_record_revision(public.work_records, text, uuid, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_assert_staff_same_org(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_lock_employment_term_scope(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_employment_term_integrity() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_employment_term_mutation_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_work_record_integrity() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_work_record_mutation_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_work_record_revision_integrity() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_work_record_revision_mutation_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_employment_term(uuid, integer, date, date, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_employment_term(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_or_update_work_record_draft(uuid, uuid, date, time, time, smallint, integer, integer, uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_work_record(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reopen_work_record(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.void_work_record(uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.regapro_has_any_work_record_permission(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.regapro_has_any_work_record_permission(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_employment_term(uuid, integer, date, date, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_employment_term(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_or_update_work_record_draft(uuid, uuid, date, time, time, smallint, integer, integer, uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_work_record(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_work_record(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_work_record(uuid, text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.create_employment_term(uuid, integer, date, date, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_employment_term(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_or_update_work_record_draft(uuid, uuid, date, time, time, smallint, integer, integer, uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_work_record(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.reopen_work_record(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.void_work_record(uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.employment_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_record_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY employment_terms_select ON public.employment_terms
  FOR SELECT USING (
    public.regapro_staff_belongs_to_org(org_id)
    AND (
      (
        staff_id = public.regapro_current_staff_id()
        AND (
          public.regapro_has_any_work_record_permission(org_id)
          OR public.regapro_staff_has_permission(org_id, 'employment_terms.manage')
        )
      )
      OR public.regapro_staff_has_permission(org_id, 'employment_terms.manage')
    )
  );

CREATE POLICY work_records_select ON public.work_records
  FOR SELECT USING (
    public.regapro_staff_belongs_to_org(org_id)
    AND (
      (
        staff_id = public.regapro_current_staff_id()
        AND public.regapro_has_any_work_record_permission(org_id)
      )
      OR public.regapro_staff_has_permission(org_id, 'work_record.manage')
    )
  );

CREATE POLICY work_record_revisions_select ON public.work_record_revisions
  FOR SELECT USING (
    public.regapro_staff_belongs_to_org(org_id)
    AND EXISTS (
      SELECT 1
      FROM public.work_records wr
      WHERE wr.id = work_record_id
        AND wr.org_id = org_id
        AND (
          (
            wr.staff_id = public.regapro_current_staff_id()
            AND public.regapro_has_any_work_record_permission(org_id)
          )
          OR public.regapro_staff_has_permission(org_id, 'work_record.manage')
        )
    )
  );
