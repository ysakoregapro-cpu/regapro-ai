-- Phase 4: Weekly Pay Application / Policy Snapshot.
-- Confirmed Work Records + employment wage snapshots + versioned policy.
-- Shift is never payroll SoT. Bank / paid / transfer are later phases.
-- Module registry stays featureState=planned (no nav UI in this phase).
-- Forward-only. Explicit EXECUTE grants required after Phase 3.6 defaults.

CREATE TABLE public.weekly_pay_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  version integer NOT NULL CHECK (version >= 1),
  advance_rate_bps integer NOT NULL CHECK (advance_rate_bps > 0 AND advance_rate_bps <= 10000),
  daily_cap_minutes integer NOT NULL CHECK (daily_cap_minutes > 0),
  daily_cap_scope text NOT NULL CHECK (daily_cap_scope IN ('per_work_record', 'per_calendar_day')),
  rounding_unit_yen integer NOT NULL CHECK (rounding_unit_yen > 0),
  include_transport_fee boolean NOT NULL DEFAULT false,
  week_start_iso_dow integer NOT NULL DEFAULT 1 CHECK (week_start_iso_dow = 1),
  payment_offset_days integer NOT NULL CHECK (payment_offset_days > 0),
  effective_from date NOT NULL,
  effective_to date,
  created_by_staff_id uuid NOT NULL REFERENCES public.staff(staff_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by_staff_id uuid REFERENCES public.staff(staff_id),
  CONSTRAINT weekly_pay_policies_range CHECK (
    effective_to IS NULL OR effective_to >= effective_from
  ),
  CONSTRAINT weekly_pay_policies_version_unique UNIQUE (org_id, version)
);

CREATE INDEX idx_weekly_pay_policies_org_active
  ON public.weekly_pay_policies (org_id, effective_from DESC)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE public.weekly_pay_policies IS
  'Versioned weekly-pay calculation policy. Applications snapshot the applied row.';

CREATE TABLE public.weekly_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  staff_id uuid NOT NULL REFERENCES public.staff(staff_id),
  week_start date NOT NULL,
  week_end date NOT NULL,
  cutoff_at timestamptz NOT NULL,
  payment_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'submitted', 'returned', 'approved')),
  total_amount_yen integer NOT NULL CHECK (total_amount_yen >= 0),
  policy_id uuid NOT NULL REFERENCES public.weekly_pay_policies(id),
  policy_version integer NOT NULL CHECK (policy_version >= 1),
  policy_snapshot jsonb NOT NULL,
  submitted_at timestamptz,
  submitted_by_staff_id uuid REFERENCES public.staff(staff_id),
  returned_at timestamptz,
  returned_by_staff_id uuid REFERENCES public.staff(staff_id),
  return_reason text,
  approved_at timestamptz,
  approved_by_staff_id uuid REFERENCES public.staff(staff_id),
  created_by_staff_id uuid NOT NULL REFERENCES public.staff(staff_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT weekly_applications_week_shape CHECK (week_end = week_start + 6),
  CONSTRAINT weekly_applications_lifecycle CHECK (
    (
      status = 'draft'
      AND submitted_at IS NULL AND submitted_by_staff_id IS NULL
      AND returned_at IS NULL AND returned_by_staff_id IS NULL AND return_reason IS NULL
      AND approved_at IS NULL AND approved_by_staff_id IS NULL
    )
    OR (
      status = 'submitted'
      AND submitted_at IS NOT NULL AND submitted_by_staff_id IS NOT NULL
      AND approved_at IS NULL AND approved_by_staff_id IS NULL
    )
    OR (
      status = 'returned'
      AND submitted_at IS NOT NULL AND submitted_by_staff_id IS NOT NULL
      AND returned_at IS NOT NULL AND returned_by_staff_id IS NOT NULL
      AND return_reason IS NOT NULL
      AND approved_at IS NULL AND approved_by_staff_id IS NULL
    )
    OR (
      status = 'approved'
      AND submitted_at IS NOT NULL AND submitted_by_staff_id IS NOT NULL
      AND approved_at IS NOT NULL AND approved_by_staff_id IS NOT NULL
      AND approved_by_staff_id IS DISTINCT FROM staff_id
      AND returned_at IS NULL AND returned_by_staff_id IS NULL AND return_reason IS NULL
    )
  ),
  CONSTRAINT weekly_applications_staff_week_unique UNIQUE (org_id, staff_id, week_start)
);

CREATE INDEX idx_weekly_applications_org_status
  ON public.weekly_applications (org_id, status, week_start DESC);
CREATE INDEX idx_weekly_applications_org_staff
  ON public.weekly_applications (org_id, staff_id, week_start DESC);

COMMENT ON TABLE public.weekly_applications IS
  'Weekly pay application header. No paid status in Phase 4. Amounts are server-computed snapshots.';

CREATE TABLE public.weekly_application_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.weekly_applications(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  work_record_id uuid NOT NULL REFERENCES public.work_records(id),
  work_record_revision_no integer NOT NULL CHECK (work_record_revision_no >= 1),
  work_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  end_day_offset smallint NOT NULL CHECK (end_day_offset IN (0, 1)),
  worked_minutes integer NOT NULL CHECK (worked_minutes > 0),
  eligible_minutes integer NOT NULL CHECK (eligible_minutes >= 0),
  employment_term_id uuid NOT NULL REFERENCES public.employment_terms(id),
  hourly_wage_yen integer NOT NULL CHECK (hourly_wage_yen > 0),
  transport_fee_yen integer NOT NULL CHECK (transport_fee_yen >= 0),
  eligible_amount_yen integer NOT NULL CHECK (eligible_amount_yen >= 0),
  policy_id uuid NOT NULL REFERENCES public.weekly_pay_policies(id),
  policy_version integer NOT NULL CHECK (policy_version >= 1),
  calculation_trace jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT weekly_application_items_work_record_unique UNIQUE (work_record_id),
  CONSTRAINT weekly_application_items_eligible_le_worked CHECK (eligible_minutes <= worked_minutes)
);

CREATE INDEX idx_weekly_application_items_app
  ON public.weekly_application_items (application_id);

CREATE TABLE public.weekly_pay_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  actor_staff_id uuid REFERENCES public.staff(staff_id),
  subject_staff_id uuid REFERENCES public.staff(staff_id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_weekly_pay_audit_org_created
  ON public.weekly_pay_audit_events (org_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.regapro_weekly_pay_rpc_active()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT current_setting('regapro.weekly_pay_rpc', true) = '1';
$$;

CREATE OR REPLACE FUNCTION public.regapro_has_any_weekly_pay_permission(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.regapro_staff_has_permission(p_org_id, 'weekly_pay.submit')
    OR public.regapro_staff_has_permission(p_org_id, 'weekly_pay.review')
    OR public.regapro_staff_has_permission(p_org_id, 'weekly_pay.pay')
    OR public.regapro_staff_has_permission(p_org_id, 'weekly_pay.manage')
    OR public.regapro_staff_has_permission(p_org_id, 'weekly_pay.policy_manage');
$$;

CREATE OR REPLACE FUNCTION public.regapro_write_weekly_pay_audit(
  p_org_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_actor_staff_id uuid,
  p_subject_staff_id uuid,
  p_metadata jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.weekly_pay_audit_events (
    org_id, action, entity_type, entity_id, actor_staff_id, subject_staff_id, metadata
  ) VALUES (
    p_org_id, p_action, p_entity_type, p_entity_id, p_actor_staff_id, p_subject_staff_id,
    COALESCE(p_metadata, '{}'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.regapro_weekly_pay_week_start(
  p_date date,
  p_week_start_iso_dow integer DEFAULT 1
)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_week_start_iso_dow <> 1 THEN NULL
    ELSE p_date - ((EXTRACT(ISODOW FROM p_date)::integer) - 1)
  END;
$$;

CREATE OR REPLACE FUNCTION public.regapro_weekly_pay_week_end(p_week_start date)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT p_week_start + 6;
$$;

CREATE OR REPLACE FUNCTION public.regapro_weekly_pay_cutoff_at(p_week_start date)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT ((p_week_start + 7)::timestamp AT TIME ZONE 'Asia/Tokyo');
$$;

CREATE OR REPLACE FUNCTION public.regapro_weekly_pay_payment_date(
  p_week_start date,
  p_offset integer
)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT p_week_start + p_offset;
$$;

CREATE OR REPLACE FUNCTION public.regapro_weekly_pay_item_amount(
  p_hourly_wage_yen integer,
  p_eligible_minutes integer,
  p_advance_rate_bps integer,
  p_rounding_unit_yen integer,
  p_include_transport_fee boolean,
  p_transport_fee_yen integer
)
RETURNS TABLE(raw_amount_yen integer, eligible_amount_yen integer)
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  WITH raw AS (
    SELECT (
      (p_hourly_wage_yen::bigint * p_eligible_minutes::bigint * p_advance_rate_bps::bigint)
      / 600000
    )::integer
    + CASE WHEN p_include_transport_fee THEN COALESCE(p_transport_fee_yen, 0) ELSE 0 END
      AS raw_amount
  )
  SELECT
    raw_amount,
    ((raw_amount::bigint / p_rounding_unit_yen) * p_rounding_unit_yen)::integer
  FROM raw;
$$;

CREATE OR REPLACE FUNCTION public.regapro_active_weekly_pay_policy(p_org_id uuid, p_on date)
RETURNS public.weekly_pay_policies
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_policy public.weekly_pay_policies;
BEGIN
  SELECT * INTO v_policy
  FROM public.weekly_pay_policies p
  WHERE p.org_id = p_org_id
    AND p.revoked_at IS NULL
    AND p.effective_from <= p_on
    AND (p.effective_to IS NULL OR p.effective_to >= p_on)
  ORDER BY p.version DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WEEKLY_PAY_NO_POLICY: no active weekly pay policy for date %', p_on;
  END IF;
  RETURN v_policy;
END;
$$;

CREATE OR REPLACE FUNCTION public.regapro_lock_weekly_pay_week(
  p_org_id uuid,
  p_staff_id uuid,
  p_week_start date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      p_org_id::text || ':' || p_staff_id::text || ':' || p_week_start::text,
      0
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.regapro_touch_weekly_pay_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_weekly_applications_updated_at
  BEFORE UPDATE ON public.weekly_applications
  FOR EACH ROW EXECUTE FUNCTION public.regapro_touch_weekly_pay_updated_at();

CREATE OR REPLACE FUNCTION public.regapro_weekly_pay_service_role()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(auth.jwt() ->> 'role', '') = 'service_role';
$$;

CREATE OR REPLACE FUNCTION public.regapro_weekly_application_mutation_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- INSERT left open for service_role fixtures (same pattern as work_records).
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF public.regapro_weekly_pay_rpc_active() OR public.regapro_weekly_pay_service_role() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: mutate weekly_applications via RPC only'
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER trg_weekly_applications_mutation_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.weekly_applications
  FOR EACH ROW EXECUTE FUNCTION public.regapro_weekly_application_mutation_guard();

CREATE OR REPLACE FUNCTION public.regapro_weekly_application_item_mutation_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF public.regapro_weekly_pay_rpc_active() OR public.regapro_weekly_pay_service_role() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: mutate weekly_application_items via RPC only'
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER trg_weekly_application_items_mutation_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.weekly_application_items
  FOR EACH ROW EXECUTE FUNCTION public.regapro_weekly_application_item_mutation_guard();

CREATE OR REPLACE FUNCTION public.regapro_weekly_pay_policy_mutation_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF public.regapro_weekly_pay_rpc_active() OR public.regapro_weekly_pay_service_role() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: mutate weekly_pay_policies via RPC only'
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER trg_weekly_pay_policies_mutation_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.weekly_pay_policies
  FOR EACH ROW EXECUTE FUNCTION public.regapro_weekly_pay_policy_mutation_guard();

CREATE OR REPLACE FUNCTION public.regapro_work_record_weekly_pay_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.status IN ('confirmed', 'locked')
     AND NEW.status IN ('draft', 'voided')
     AND EXISTS (
       SELECT 1
       FROM public.weekly_application_items i
       JOIN public.weekly_applications a ON a.id = i.application_id
       WHERE i.work_record_id = OLD.id
         AND a.status IN ('draft', 'submitted', 'approved')
     )
  THEN
    RAISE EXCEPTION
      'WEEKLY_PAY_CONFLICT: work record is on an active weekly application'
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_work_records_weekly_pay_guard
  BEFORE UPDATE ON public.work_records
  FOR EACH ROW EXECUTE FUNCTION public.regapro_work_record_weekly_pay_guard();

CREATE OR REPLACE FUNCTION public.upsert_weekly_pay_policy(
  p_advance_rate_bps integer,
  p_daily_cap_minutes integer,
  p_daily_cap_scope text,
  p_rounding_unit_yen integer,
  p_include_transport_fee boolean,
  p_week_start_iso_dow integer,
  p_payment_offset_days integer,
  p_effective_from date,
  p_effective_to date DEFAULT NULL
)
RETURNS public.weekly_pay_policies
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_org uuid;
  v_version integer;
  v_policy public.weekly_pay_policies;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  SELECT s.org_id INTO v_org FROM public.staff s
  WHERE s.staff_id = v_actor AND s.status = 'active';
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  IF NOT public.regapro_staff_has_permission(v_org, 'weekly_pay.policy_manage') THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: weekly_pay.policy_manage required' USING ERRCODE = '42501';
  END IF;
  IF p_advance_rate_bps IS NULL OR p_advance_rate_bps <= 0 OR p_advance_rate_bps > 10000 THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_SELECTION: advance_rate_bps out of range';
  END IF;
  IF p_daily_cap_minutes IS NULL OR p_daily_cap_minutes <= 0 THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_SELECTION: daily_cap_minutes must be > 0';
  END IF;
  IF p_daily_cap_scope IS NULL
     OR p_daily_cap_scope NOT IN ('per_work_record', 'per_calendar_day') THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_SELECTION: invalid daily_cap_scope';
  END IF;
  IF p_rounding_unit_yen IS NULL OR p_rounding_unit_yen <= 0 THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_SELECTION: rounding_unit_yen must be > 0';
  END IF;
  IF COALESCE(p_week_start_iso_dow, 1) <> 1 THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_SELECTION: only Monday week start is supported';
  END IF;
  IF p_payment_offset_days IS NULL OR p_payment_offset_days <= 0 THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_SELECTION: payment_offset_days must be > 0';
  END IF;
  IF p_effective_from IS NULL THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_SELECTION: effective_from required';
  END IF;
  IF p_effective_to IS NOT NULL AND p_effective_to < p_effective_from THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_SELECTION: effective_to before effective_from';
  END IF;

  PERFORM set_config('regapro.weekly_pay_rpc', '1', true);

  -- Close currently open-ended active policies the day before the new one.
  UPDATE public.weekly_pay_policies
    SET effective_to = p_effective_from - 1
  WHERE org_id = v_org
    AND revoked_at IS NULL
    AND effective_to IS NULL
    AND effective_from < p_effective_from;

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_version
  FROM public.weekly_pay_policies
  WHERE org_id = v_org;

  INSERT INTO public.weekly_pay_policies (
    org_id, version, advance_rate_bps, daily_cap_minutes, daily_cap_scope,
    rounding_unit_yen, include_transport_fee, week_start_iso_dow, payment_offset_days,
    effective_from, effective_to, created_by_staff_id
  ) VALUES (
    v_org, v_version, p_advance_rate_bps, p_daily_cap_minutes, p_daily_cap_scope,
    p_rounding_unit_yen, COALESCE(p_include_transport_fee, false), 1, p_payment_offset_days,
    p_effective_from, p_effective_to, v_actor
  )
  RETURNING * INTO v_policy;

  PERFORM public.regapro_write_weekly_pay_audit(
    v_org, 'weekly_pay_policy_upserted', 'weekly_pay_policy', v_policy.id,
    v_actor, NULL,
    jsonb_build_object('version', v_version, 'advance_rate_bps', p_advance_rate_bps)
  );
  RETURN v_policy;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_or_replace_weekly_application_draft(
  p_work_record_ids uuid[],
  p_for_staff_id uuid DEFAULT NULL
)
RETURNS public.weekly_applications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_org uuid;
  v_target uuid;
  v_ids uuid[];
  v_today date := (timezone('Asia/Tokyo', now()))::date;
  v_week_start date;
  v_week_end date;
  v_cutoff timestamptz;
  v_payment date;
  v_policy public.weekly_pay_policies;
  v_snapshot jsonb;
  v_total integer := 0;
  v_app public.weekly_applications;
  v_count integer;
  v_existing_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  SELECT s.org_id INTO v_org FROM public.staff s
  WHERE s.staff_id = v_actor AND s.status = 'active';
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  IF p_work_record_ids IS NULL OR cardinality(p_work_record_ids) = 0 THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_SELECTION: no work records selected';
  END IF;

  SELECT array_agg(DISTINCT x) INTO v_ids FROM unnest(p_work_record_ids) AS x;
  v_target := COALESCE(p_for_staff_id, v_actor);

  IF v_target <> v_actor
     AND NOT public.regapro_staff_has_permission(v_org, 'weekly_pay.manage') THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: cannot create for another staff' USING ERRCODE = '42501';
  END IF;
  IF v_target = v_actor AND NOT (
    public.regapro_staff_has_permission(v_org, 'weekly_pay.submit')
    OR public.regapro_staff_has_permission(v_org, 'weekly_pay.manage')
  ) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: weekly_pay.submit required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.staff s
    WHERE s.staff_id = v_target AND s.org_id = v_org AND s.status = 'active'
  ) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_NOT_FOUND: staff';
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.work_records wr
  WHERE wr.id = ANY (v_ids)
    AND wr.org_id = v_org
    AND wr.staff_id = v_target;
  IF v_count <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_SELECTION: invalid work_record selection'
      USING ERRCODE = '42501';
  END IF;

  SELECT public.regapro_weekly_pay_week_start(min(wr.work_date), 1)
  INTO v_week_start
  FROM public.work_records wr
  WHERE wr.id = ANY (v_ids);

  v_week_end := public.regapro_weekly_pay_week_end(v_week_start);
  v_cutoff := public.regapro_weekly_pay_cutoff_at(v_week_start);
  v_policy := public.regapro_active_weekly_pay_policy(v_org, v_today);
  v_payment := public.regapro_weekly_pay_payment_date(v_week_start, v_policy.payment_offset_days);

  IF now() >= v_cutoff THEN
    RAISE EXCEPTION 'WEEKLY_PAY_WEEK_CUTOFF: week cutoff passed';
  END IF;

  PERFORM set_config('regapro.weekly_pay_rpc', '1', true);
  PERFORM public.regapro_lock_weekly_pay_week(v_org, v_target, v_week_start);

  SELECT a.id INTO v_existing_id
  FROM public.weekly_applications a
  WHERE a.org_id = v_org AND a.staff_id = v_target AND a.week_start = v_week_start
  FOR UPDATE;

  IF v_existing_id IS NOT NULL THEN
    SELECT * INTO v_app FROM public.weekly_applications WHERE id = v_existing_id;
    IF v_app.status NOT IN ('draft', 'returned') THEN
      RAISE EXCEPTION 'WEEKLY_PAY_DUPLICATE_WEEK: application already exists for week'
        USING ERRCODE = '23505';
    END IF;
    DELETE FROM public.weekly_application_items WHERE application_id = v_existing_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.work_records wr
    WHERE wr.id = ANY (v_ids) AND wr.status NOT IN ('confirmed', 'locked')
  ) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_SELECTION: only confirmed or locked work records are eligible';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.work_records wr
    WHERE wr.id = ANY (v_ids)
      AND (wr.employment_term_id IS NULL OR wr.hourly_wage_snapshot_yen IS NULL)
  ) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_NO_WAGE: work record has no wage snapshot';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.work_records wr
    WHERE wr.id = ANY (v_ids)
      AND public.regapro_weekly_pay_week_start(wr.work_date, 1) <> v_week_start
  ) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_CROSS_WEEK: work records must be in the same week';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.work_records wr
    WHERE wr.id = ANY (v_ids) AND wr.work_date > v_today
  ) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FUTURE_WORK_DATE: future work_date is not allowed';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.weekly_application_items i
    WHERE i.work_record_id = ANY (v_ids)
      AND (v_existing_id IS NULL OR i.application_id <> v_existing_id)
  ) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_ALREADY_APPLIED: work_record already applied'
      USING ERRCODE = '23505';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _wp_calc (
    work_record_id uuid PRIMARY KEY,
    work_record_revision_no integer,
    work_date date,
    start_time time,
    end_time time,
    end_day_offset smallint,
    worked_minutes integer,
    eligible_minutes integer,
    employment_term_id uuid,
    hourly_wage_yen integer,
    transport_fee_yen integer,
    eligible_amount_yen integer,
    calculation_trace jsonb
  ) ON COMMIT DROP;
  DELETE FROM _wp_calc;

  INSERT INTO _wp_calc
  SELECT
    s.work_record_id,
    s.work_record_revision_no,
    s.work_date,
    s.start_time,
    s.end_time,
    s.end_day_offset,
    s.worked_minutes,
    s.eligible_minutes,
    s.employment_term_id,
    s.hourly_wage_yen,
    s.transport_fee_yen,
    amt.eligible_amount_yen,
    jsonb_build_object(
      'workedMinutes', s.worked_minutes,
      'dailyCapMinutes', v_policy.daily_cap_minutes,
      'dailyCapScope', v_policy.daily_cap_scope,
      'eligibleMinutes', s.eligible_minutes,
      'hourlyWageYen', s.hourly_wage_yen,
      'advanceRateBps', v_policy.advance_rate_bps,
      'includeTransportFee', v_policy.include_transport_fee,
      'transportFeeYen', s.transport_fee_yen,
      'rawAmountYen', amt.raw_amount_yen,
      'roundingUnitYen', v_policy.rounding_unit_yen,
      'eligibleAmountYen', amt.eligible_amount_yen,
      'formula',
        'floor((hourly_wage_yen * eligible_minutes * advance_rate_bps / 600000) / rounding_unit_yen) * rounding_unit_yen'
    )
  FROM (
    SELECT
      wr.id AS work_record_id,
      COALESCE((
        SELECT max(r.revision_no) FROM public.work_record_revisions r
        WHERE r.work_record_id = wr.id
      ), 1) AS work_record_revision_no,
      wr.work_date,
      wr.start_time,
      wr.end_time,
      wr.end_day_offset,
      wr.worked_minutes,
      wr.employment_term_id,
      wr.hourly_wage_snapshot_yen AS hourly_wage_yen,
      wr.transport_fee_yen,
      CASE
        WHEN v_policy.daily_cap_scope = 'per_work_record' THEN
          LEAST(wr.worked_minutes, v_policy.daily_cap_minutes)
        ELSE
          LEAST(
            wr.worked_minutes,
            GREATEST(
              0,
              v_policy.daily_cap_minutes
              - COALESCE(SUM(wr.worked_minutes) OVER (
                  PARTITION BY wr.work_date
                  ORDER BY wr.work_date, wr.start_time, wr.id
                  ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                ), 0)
            )
          )
      END AS eligible_minutes,
      wr.status,
      public.regapro_weekly_pay_week_start(wr.work_date, 1) AS rec_week_start
    FROM public.work_records wr
    WHERE wr.id = ANY (v_ids)
  ) s
  CROSS JOIN LATERAL public.regapro_weekly_pay_item_amount(
    s.hourly_wage_yen,
    s.eligible_minutes,
    v_policy.advance_rate_bps,
    v_policy.rounding_unit_yen,
    v_policy.include_transport_fee,
    s.transport_fee_yen
  ) amt;

  SELECT COALESCE(SUM(eligible_amount_yen), 0) INTO v_total FROM _wp_calc;
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'WEEKLY_PAY_ZERO_AMOUNT: total eligible amount must be > 0';
  END IF;

  v_snapshot := jsonb_build_object(
    'policyId', v_policy.id,
    'version', v_policy.version,
    'advanceRateBps', v_policy.advance_rate_bps,
    'dailyCapMinutes', v_policy.daily_cap_minutes,
    'dailyCapScope', v_policy.daily_cap_scope,
    'roundingUnitYen', v_policy.rounding_unit_yen,
    'includeTransportFee', v_policy.include_transport_fee,
    'weekStartIsoDow', v_policy.week_start_iso_dow,
    'paymentOffsetDays', v_policy.payment_offset_days
  );

  IF v_existing_id IS NULL THEN
    INSERT INTO public.weekly_applications (
      org_id, staff_id, week_start, week_end, cutoff_at, payment_date,
      status, total_amount_yen, policy_id, policy_version, policy_snapshot,
      created_by_staff_id
    ) VALUES (
      v_org, v_target, v_week_start, v_week_end, v_cutoff, v_payment,
      'draft', v_total, v_policy.id, v_policy.version, v_snapshot,
      v_actor
    )
    RETURNING * INTO v_app;
  ELSE
    UPDATE public.weekly_applications
      SET week_end = v_week_end,
          cutoff_at = v_cutoff,
          payment_date = v_payment,
          status = 'draft',
          total_amount_yen = v_total,
          policy_id = v_policy.id,
          policy_version = v_policy.version,
          policy_snapshot = v_snapshot,
          submitted_at = NULL,
          submitted_by_staff_id = NULL,
          returned_at = NULL,
          returned_by_staff_id = NULL,
          return_reason = NULL,
          approved_at = NULL,
          approved_by_staff_id = NULL
    WHERE id = v_existing_id
    RETURNING * INTO v_app;
  END IF;

  INSERT INTO public.weekly_application_items (
    application_id, org_id, work_record_id, work_record_revision_no,
    work_date, start_time, end_time, end_day_offset,
    worked_minutes, eligible_minutes, employment_term_id, hourly_wage_yen,
    transport_fee_yen, eligible_amount_yen, policy_id, policy_version, calculation_trace
  )
  SELECT
    v_app.id, v_org, c.work_record_id, c.work_record_revision_no,
    c.work_date, c.start_time, c.end_time, c.end_day_offset,
    c.worked_minutes, c.eligible_minutes, c.employment_term_id, c.hourly_wage_yen,
    c.transport_fee_yen, c.eligible_amount_yen, v_policy.id, v_policy.version, c.calculation_trace
  FROM _wp_calc c;

  PERFORM public.regapro_write_weekly_pay_audit(
    v_org, 'weekly_application_drafted', 'weekly_application', v_app.id,
    v_actor, v_target,
    jsonb_build_object(
      'week_start', v_week_start,
      'total_amount_yen', v_total,
      'work_record_count', cardinality(v_ids)
    )
  );
  RETURN v_app;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_weekly_application(p_application_id uuid)
RETURNS public.weekly_applications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_app public.weekly_applications;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('regapro.weekly_pay_rpc', '1', true);

  SELECT * INTO v_app FROM public.weekly_applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WEEKLY_PAY_NOT_FOUND: weekly application';
  END IF;
  IF NOT public.regapro_staff_belongs_to_org(v_app.org_id) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: cross-org denied' USING ERRCODE = '42501';
  END IF;
  IF v_app.staff_id <> v_actor
     AND NOT public.regapro_staff_has_permission(v_app.org_id, 'weekly_pay.manage') THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: cannot submit another staff application'
      USING ERRCODE = '42501';
  END IF;
  IF v_app.staff_id = v_actor AND NOT (
    public.regapro_staff_has_permission(v_app.org_id, 'weekly_pay.submit')
    OR public.regapro_staff_has_permission(v_app.org_id, 'weekly_pay.manage')
  ) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: weekly_pay.submit required' USING ERRCODE = '42501';
  END IF;
  IF v_app.status NOT IN ('draft', 'returned') THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_TRANSITION: cannot submit from %', v_app.status;
  END IF;
  IF now() >= v_app.cutoff_at THEN
    RAISE EXCEPTION 'WEEKLY_PAY_WEEK_CUTOFF: week cutoff passed';
  END IF;
  IF v_app.total_amount_yen <= 0
     OR NOT EXISTS (
       SELECT 1 FROM public.weekly_application_items i WHERE i.application_id = v_app.id
     )
  THEN
    RAISE EXCEPTION 'WEEKLY_PAY_ZERO_AMOUNT: application has no payable items';
  END IF;

  UPDATE public.weekly_applications
    SET status = 'submitted',
        submitted_at = now(),
        submitted_by_staff_id = v_actor,
        returned_at = NULL,
        returned_by_staff_id = NULL,
        return_reason = NULL,
        approved_at = NULL,
        approved_by_staff_id = NULL
  WHERE id = v_app.id
  RETURNING * INTO v_app;

  PERFORM public.regapro_write_weekly_pay_audit(
    v_app.org_id, 'weekly_application_submitted', 'weekly_application', v_app.id,
    v_actor, v_app.staff_id,
    jsonb_build_object('total_amount_yen', v_app.total_amount_yen)
  );
  RETURN v_app;
END;
$$;

CREATE OR REPLACE FUNCTION public.return_weekly_application(
  p_application_id uuid,
  p_reason text
)
RETURNS public.weekly_applications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_app public.weekly_applications;
  v_reason text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  v_reason := btrim(COALESCE(p_reason, ''));
  IF char_length(v_reason) < 3 THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_REASON: return reason too short';
  END IF;
  IF char_length(v_reason) > 1000 THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_REASON: return reason too long';
  END IF;
  PERFORM set_config('regapro.weekly_pay_rpc', '1', true);

  SELECT * INTO v_app FROM public.weekly_applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WEEKLY_PAY_NOT_FOUND: weekly application';
  END IF;
  IF NOT public.regapro_staff_belongs_to_org(v_app.org_id) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: cross-org denied' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    public.regapro_staff_has_permission(v_app.org_id, 'weekly_pay.review')
    OR public.regapro_staff_has_permission(v_app.org_id, 'weekly_pay.manage')
  ) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: weekly_pay.review required' USING ERRCODE = '42501';
  END IF;
  IF v_app.staff_id = v_actor THEN
    RAISE EXCEPTION 'WEEKLY_PAY_SELF_REVIEW: cannot review own weekly application'
      USING ERRCODE = '42501';
  END IF;
  IF v_app.status <> 'submitted' THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_TRANSITION: cannot return from %', v_app.status;
  END IF;

  UPDATE public.weekly_applications
    SET status = 'returned',
        returned_at = now(),
        returned_by_staff_id = v_actor,
        return_reason = v_reason,
        approved_at = NULL,
        approved_by_staff_id = NULL
  WHERE id = v_app.id
  RETURNING * INTO v_app;

  PERFORM public.regapro_write_weekly_pay_audit(
    v_app.org_id, 'weekly_application_returned', 'weekly_application', v_app.id,
    v_actor, v_app.staff_id,
    jsonb_build_object('reason_length', char_length(v_reason))
  );
  RETURN v_app;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_weekly_application(p_application_id uuid)
RETURNS public.weekly_applications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_app public.weekly_applications;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('regapro.weekly_pay_rpc', '1', true);

  SELECT * INTO v_app FROM public.weekly_applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WEEKLY_PAY_NOT_FOUND: weekly application';
  END IF;
  IF NOT public.regapro_staff_belongs_to_org(v_app.org_id) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: cross-org denied' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    public.regapro_staff_has_permission(v_app.org_id, 'weekly_pay.review')
    OR public.regapro_staff_has_permission(v_app.org_id, 'weekly_pay.manage')
  ) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: weekly_pay.review required' USING ERRCODE = '42501';
  END IF;
  IF v_app.staff_id = v_actor THEN
    RAISE EXCEPTION 'WEEKLY_PAY_SELF_REVIEW: cannot review own weekly application'
      USING ERRCODE = '42501';
  END IF;
  IF v_app.status <> 'submitted' THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_TRANSITION: cannot approve from %', v_app.status;
  END IF;
  IF v_app.total_amount_yen IS NULL
     OR v_app.total_amount_yen <= 0
     OR (
       v_app.total_amount_yen
       % GREATEST(COALESCE((v_app.policy_snapshot->>'roundingUnitYen')::integer, 500), 1)
     ) <> 0
  THEN
    RAISE EXCEPTION 'WEEKLY_PAY_ZERO_AMOUNT: invalid total_amount';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.weekly_application_items i WHERE i.application_id = v_app.id
  ) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_SELECTION: application has no items';
  END IF;

  UPDATE public.weekly_applications
    SET status = 'approved',
        approved_at = now(),
        approved_by_staff_id = v_actor,
        returned_at = NULL,
        returned_by_staff_id = NULL,
        return_reason = NULL
  WHERE id = v_app.id
  RETURNING * INTO v_app;

  PERFORM public.regapro_write_weekly_pay_audit(
    v_app.org_id, 'weekly_application_approved', 'weekly_application', v_app.id,
    v_actor, v_app.staff_id,
    jsonb_build_object('total_amount_yen', v_app.total_amount_yen)
  );
  RETURN v_app;
END;
$$;

ALTER TABLE public.weekly_pay_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_application_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_pay_audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY weekly_pay_policies_select ON public.weekly_pay_policies
  FOR SELECT TO authenticated
  USING (public.regapro_has_any_weekly_pay_permission(org_id));

CREATE POLICY weekly_applications_select ON public.weekly_applications
  FOR SELECT TO authenticated
  USING (
    public.regapro_staff_belongs_to_org(org_id)
    AND (
      staff_id = public.regapro_current_staff_id()
      OR public.regapro_staff_has_permission(org_id, 'weekly_pay.review')
      OR public.regapro_staff_has_permission(org_id, 'weekly_pay.pay')
      OR public.regapro_staff_has_permission(org_id, 'weekly_pay.manage')
    )
  );

CREATE POLICY weekly_application_items_select ON public.weekly_application_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.weekly_applications a
      WHERE a.id = weekly_application_items.application_id
        AND public.regapro_staff_belongs_to_org(a.org_id)
        AND (
          a.staff_id = public.regapro_current_staff_id()
          OR public.regapro_staff_has_permission(a.org_id, 'weekly_pay.review')
          OR public.regapro_staff_has_permission(a.org_id, 'weekly_pay.pay')
          OR public.regapro_staff_has_permission(a.org_id, 'weekly_pay.manage')
        )
    )
  );

CREATE POLICY weekly_pay_audit_select ON public.weekly_pay_audit_events
  FOR SELECT TO authenticated
  USING (
    public.regapro_staff_has_permission(org_id, 'weekly_pay.manage')
    OR public.regapro_staff_has_permission(org_id, 'weekly_pay.review')
  );

GRANT SELECT ON TABLE public.weekly_pay_policies TO authenticated;
GRANT SELECT ON TABLE public.weekly_applications TO authenticated;
GRANT SELECT ON TABLE public.weekly_application_items TO authenticated;
GRANT SELECT ON TABLE public.weekly_pay_audit_events TO authenticated;

GRANT ALL ON TABLE public.weekly_pay_policies TO service_role;
GRANT ALL ON TABLE public.weekly_applications TO service_role;
GRANT ALL ON TABLE public.weekly_application_items TO service_role;
GRANT ALL ON TABLE public.weekly_pay_audit_events TO service_role;

-- Explicit EXECUTE after Phase 3.6 default-privilege hardening.
REVOKE ALL ON FUNCTION public.regapro_weekly_pay_rpc_active() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_has_any_weekly_pay_permission(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_write_weekly_pay_audit(uuid, text, text, uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_weekly_pay_week_start(date, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_weekly_pay_week_end(date) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_weekly_pay_cutoff_at(date) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_weekly_pay_payment_date(date, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_weekly_pay_item_amount(integer, integer, integer, integer, boolean, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_active_weekly_pay_policy(uuid, date) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_lock_weekly_pay_week(uuid, uuid, date) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_touch_weekly_pay_updated_at() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_weekly_pay_service_role() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_weekly_application_mutation_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_weekly_application_item_mutation_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_weekly_pay_policy_mutation_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_work_record_weekly_pay_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.upsert_weekly_pay_policy(integer, integer, text, integer, boolean, integer, integer, date, date) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_or_replace_weekly_application_draft(uuid[], uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.submit_weekly_application(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.return_weekly_application(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.approve_weekly_application(uuid) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.regapro_has_any_weekly_pay_permission(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_weekly_pay_policy(integer, integer, text, integer, boolean, integer, integer, date, date)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_or_replace_weekly_application_draft(uuid[], uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_weekly_application(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.return_weekly_application(uuid, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_weekly_application(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.regapro_weekly_pay_acl_privileges()
RETURNS TABLE (
  grantee text,
  function_identity text,
  kind text,
  can_execute boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH identities(function_identity, kind) AS (
    VALUES
      ('public.create_or_replace_weekly_application_draft(uuid[], uuid)', 'business'),
      ('public.submit_weekly_application(uuid)', 'business'),
      ('public.return_weekly_application(uuid, text)', 'business'),
      ('public.approve_weekly_application(uuid)', 'business'),
      ('public.upsert_weekly_pay_policy(integer, integer, text, integer, boolean, integer, integer, date, date)', 'business'),
      ('public.regapro_has_any_weekly_pay_permission(uuid)', 'rls_helper'),
      ('public.regapro_weekly_pay_rpc_active()', 'internal'),
      ('public.regapro_write_weekly_pay_audit(uuid, text, text, uuid, uuid, uuid, jsonb)', 'internal'),
      ('public.regapro_weekly_pay_week_start(date, integer)', 'internal'),
      ('public.regapro_weekly_pay_week_end(date)', 'internal'),
      ('public.regapro_weekly_pay_cutoff_at(date)', 'internal'),
      ('public.regapro_weekly_pay_payment_date(date, integer)', 'internal'),
      ('public.regapro_weekly_pay_item_amount(integer, integer, integer, integer, boolean, integer)', 'internal'),
      ('public.regapro_active_weekly_pay_policy(uuid, date)', 'internal'),
      ('public.regapro_lock_weekly_pay_week(uuid, uuid, date)', 'internal'),
      ('public.regapro_weekly_pay_service_role()', 'internal'),
      ('public.regapro_weekly_application_mutation_guard()', 'internal'),
      ('public.regapro_weekly_application_item_mutation_guard()', 'internal'),
      ('public.regapro_weekly_pay_policy_mutation_guard()', 'internal'),
      ('public.regapro_work_record_weekly_pay_guard()', 'internal')
  ),
  roles(grantee) AS (
    VALUES ('anon'::text), ('authenticated'::text), ('service_role'::text)
  )
  SELECT
    r.grantee,
    i.function_identity,
    i.kind,
    has_function_privilege(r.grantee, i.function_identity, 'EXECUTE') AS can_execute
  FROM roles r
  CROSS JOIN identities i;
$$;

COMMENT ON FUNCTION public.regapro_weekly_pay_acl_privileges() IS
  'Read-only Phase 4 function EXECUTE matrix for ACL tests. Not a business RPC.';

REVOKE ALL ON FUNCTION public.regapro_weekly_pay_acl_privileges()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regapro_weekly_pay_acl_privileges()
  TO service_role;

DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(format('%s %s execute=%s', grantee, function_identity, can_execute), '; ')
    INTO v_bad
  FROM public.regapro_weekly_pay_acl_privileges()
  WHERE (kind = 'business' AND (
          (grantee = 'anon' AND can_execute)
          OR (grantee IN ('authenticated', 'service_role') AND NOT can_execute)
        ))
     OR (kind = 'rls_helper' AND (
          (grantee = 'anon' AND can_execute)
          OR (grantee IN ('authenticated', 'service_role') AND NOT can_execute)
        ))
     OR (kind = 'internal' AND can_execute);

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'WEEKLY_PAY_ACL: unexpected EXECUTE grants: %', v_bad;
  END IF;
END;
$$;
