-- Phase 2: Shift Domain Foundation.
-- Shift = planned work. Work Record / Weekly Pay tables are intentionally absent.
-- Person identity is staff_id. Display names are never keys.
-- Forward-only. Do not apply to a linked project without review.

-- ---------------------------------------------------------------------------
-- work_locations
-- ---------------------------------------------------------------------------

CREATE TABLE public.work_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  code text NOT NULL,
  name text NOT NULL,
  address_text text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (org_id, code)
);

CREATE INDEX idx_work_locations_org_active ON public.work_locations (org_id, is_active);
CREATE INDEX idx_work_locations_org_name ON public.work_locations (org_id, name);

COMMENT ON TABLE public.work_locations IS
  'Workplace master (store, venue, office). Not a person identity. time_unspecified is a shift property, not a location type.';

-- ---------------------------------------------------------------------------
-- shift_requests
-- ---------------------------------------------------------------------------

CREATE TABLE public.shift_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  staff_id uuid NOT NULL REFERENCES public.staff(staff_id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  previous_request_id uuid REFERENCES public.shift_requests(id),
  status text NOT NULL CHECK (status IN ('draft', 'submitted', 'superseded', 'cancelled')),
  requested_by_staff_id uuid NOT NULL REFERENCES public.staff(staff_id),
  submitted_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shift_requests_period_order CHECK (period_end >= period_start),
  CONSTRAINT shift_requests_lifecycle_shape CHECK (
    (status = 'draft' AND submitted_at IS NULL AND cancelled_at IS NULL)
    OR (status = 'submitted' AND submitted_at IS NOT NULL AND cancelled_at IS NULL)
    OR (status = 'superseded' AND submitted_at IS NOT NULL AND cancelled_at IS NULL)
    OR (status = 'cancelled' AND cancelled_at IS NOT NULL)
  ),
  UNIQUE (org_id, staff_id, period_start, version)
);

CREATE UNIQUE INDEX uq_shift_requests_one_submitted
  ON public.shift_requests (org_id, staff_id, period_start, period_end)
  WHERE status = 'submitted';

CREATE INDEX idx_shift_requests_org_staff_period
  ON public.shift_requests (org_id, staff_id, period_start, period_end);

COMMENT ON TABLE public.shift_requests IS
  'Staff-submitted scheduling input. Not an approval workflow and never payroll source of truth. One submitted row per staff/period.';

-- ---------------------------------------------------------------------------
-- shift_request_dates
-- ---------------------------------------------------------------------------

CREATE TABLE public.shift_request_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_request_id uuid NOT NULL REFERENCES public.shift_requests(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  work_date date NOT NULL,
  preference_type text NOT NULL CHECK (preference_type IN ('hope_work', 'hope_off')),
  start_time time,
  end_time time,
  work_location_id uuid REFERENCES public.work_locations(id),
  note text,
  time_unspecified boolean GENERATED ALWAYS AS (start_time IS NULL AND end_time IS NULL) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shift_request_id, work_date),
  CONSTRAINT shift_request_dates_time_pair CHECK (
    (start_time IS NULL AND end_time IS NULL)
    OR (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)
  ),
  CONSTRAINT shift_request_dates_hope_off CHECK (
    preference_type <> 'hope_off'
    OR (start_time IS NULL AND end_time IS NULL AND work_location_id IS NULL)
  )
);

CREATE INDEX idx_shift_request_dates_org_date
  ON public.shift_request_dates (org_id, work_date);

COMMENT ON TABLE public.shift_request_dates IS
  'One preference per date inside a shift_request. hope_work and hope_off cannot share a date. time_unspecified is derived.';

-- ---------------------------------------------------------------------------
-- shifts
-- ---------------------------------------------------------------------------

CREATE TABLE public.shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  staff_id uuid NOT NULL REFERENCES public.staff(staff_id),
  work_date date NOT NULL,
  start_time time,
  end_time time,
  end_day_offset smallint NOT NULL DEFAULT 0 CHECK (end_day_offset IN (0, 1)),
  work_location_id uuid REFERENCES public.work_locations(id),
  source text NOT NULL DEFAULT 'internal'
    CHECK (source IN ('internal', 'spreadsheet', 'imported')),
  source_request_date_id uuid REFERENCES public.shift_request_dates(id),
  external_ref text,
  status text NOT NULL CHECK (status IN ('draft', 'published', 'cancelled')),
  note text,
  pre_report_url text,
  time_unspecified boolean GENERATED ALWAYS AS (start_time IS NULL AND end_time IS NULL) STORED,
  published_at timestamptz,
  published_by_staff_id uuid REFERENCES public.staff(staff_id),
  cancelled_at timestamptz,
  cancelled_by_staff_id uuid REFERENCES public.staff(staff_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shifts_time_integrity CHECK (
    (start_time IS NULL AND end_time IS NULL AND end_day_offset = 0)
    OR (
      start_time IS NOT NULL
      AND end_time IS NOT NULL
      AND end_day_offset = 0
      AND end_time > start_time
    )
    OR (
      start_time IS NOT NULL
      AND end_time IS NOT NULL
      AND end_day_offset = 1
    )
  ),
  CONSTRAINT shifts_lifecycle_shape CHECK (
    (
      status = 'draft'
      AND published_at IS NULL
      AND published_by_staff_id IS NULL
      AND cancelled_at IS NULL
      AND cancelled_by_staff_id IS NULL
    )
    OR (
      status = 'published'
      AND published_at IS NOT NULL
      AND published_by_staff_id IS NOT NULL
      AND cancelled_at IS NULL
      AND cancelled_by_staff_id IS NULL
    )
    OR (
      status = 'cancelled'
      AND cancelled_at IS NOT NULL
      AND cancelled_by_staff_id IS NOT NULL
      AND (
        (published_at IS NULL AND published_by_staff_id IS NULL)
        OR (published_at IS NOT NULL AND published_by_staff_id IS NOT NULL)
      )
    )
  )
);

CREATE INDEX idx_shifts_org_staff_date ON public.shifts (org_id, staff_id, work_date);
CREATE INDEX idx_shifts_org_status_date ON public.shifts (org_id, status, work_date);

CREATE UNIQUE INDEX uq_shifts_external_ref
  ON public.shifts (org_id, source, external_ref)
  WHERE external_ref IS NOT NULL;

COMMENT ON TABLE public.shifts IS
  'Company-published planned work. Multiple rows per staff/day are allowed. Never the payroll source of truth. time_unspecified is derived. external_ref is an adapter key, never a person name.';

COMMENT ON COLUMN public.shifts.pre_report_url IS
  'Optional day-before report link. Domain does not depend on Google Form.';

COMMENT ON COLUMN public.shifts.external_ref IS
  'Spreadsheet / import adapter key. Duplicate imports are blocked by (org_id, source, external_ref).';

-- Additive audit identity: canonical staff ids as columns, not metadata-only.
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS actor_staff_id uuid REFERENCES public.staff(staff_id),
  ADD COLUMN IF NOT EXISTS subject_staff_id uuid REFERENCES public.staff(staff_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_org_resource
  ON public.audit_logs (org_id, resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_action
  ON public.audit_logs (org_id, action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_staff
  ON public.audit_logs (actor_staff_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_subject_staff
  ON public.audit_logs (subject_staff_id);

COMMENT ON TABLE public.audit_logs IS
  'Generic operational audit. actor_id remains auth.users.id. actor_staff_id / subject_staff_id are the canonical staff identities. Shift events also store before/after status in metadata. Not a weekly-pay ledger.';
COMMENT ON COLUMN public.audit_logs.actor_staff_id IS
  'Canonical actor staff_id. NULL on pre-Phase-2 rows. Never a display name.';
COMMENT ON COLUMN public.audit_logs.subject_staff_id IS
  'Canonical subject staff_id. NULL on pre-Phase-2 rows.';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.regapro_touch_updated_at()
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

CREATE TRIGGER trg_work_locations_updated_at
  BEFORE UPDATE ON public.work_locations
  FOR EACH ROW EXECUTE FUNCTION public.regapro_touch_updated_at();
CREATE TRIGGER trg_shift_requests_updated_at
  BEFORE UPDATE ON public.shift_requests
  FOR EACH ROW EXECUTE FUNCTION public.regapro_touch_updated_at();
CREATE TRIGGER trg_shift_request_dates_updated_at
  BEFORE UPDATE ON public.shift_request_dates
  FOR EACH ROW EXECUTE FUNCTION public.regapro_touch_updated_at();
CREATE TRIGGER trg_shifts_updated_at
  BEFORE UPDATE ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.regapro_touch_updated_at();

CREATE OR REPLACE FUNCTION public.regapro_has_any_shift_permission(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.regapro_staff_has_permission(p_org_id, 'shift.view_own')
      OR public.regapro_staff_has_permission(p_org_id, 'shift.request')
      OR public.regapro_staff_has_permission(p_org_id, 'shift.manage');
$$;

CREATE OR REPLACE FUNCTION public.regapro_shift_rpc_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT current_setting('regapro.shift_rpc', true) = '1';
$$;

CREATE OR REPLACE FUNCTION public.regapro_write_shift_audit(
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

CREATE OR REPLACE FUNCTION public.regapro_shift_request_date_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent public.shift_requests;
BEGIN
  SELECT * INTO v_parent
  FROM public.shift_requests
  WHERE id = NEW.shift_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SHIFT_NOT_FOUND: parent request missing';
  END IF;

  IF NEW.org_id IS DISTINCT FROM v_parent.org_id THEN
    RAISE EXCEPTION 'SHIFT_CROSS_ORG: org_id must match the parent request';
  END IF;

  IF NEW.work_date < v_parent.period_start OR NEW.work_date > v_parent.period_end THEN
    RAISE EXCEPTION 'SHIFT_DATE_OUT_OF_PERIOD: work_date must fall inside the request period';
  END IF;

  IF NEW.work_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.work_locations wl
    WHERE wl.id = NEW.work_location_id
      AND wl.org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION 'SHIFT_CROSS_ORG: work_location_id must belong to the same org';
  END IF;

  IF NOT public.regapro_shift_rpc_active() AND v_parent.status <> 'draft' THEN
    RAISE EXCEPTION 'SHIFT_REQUEST_IMMUTABLE: submitted request dates cannot be changed';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_shift_request_dates_guard
  BEFORE INSERT OR UPDATE ON public.shift_request_dates
  FOR EACH ROW EXECUTE FUNCTION public.regapro_shift_request_date_guard();

CREATE OR REPLACE FUNCTION public.regapro_shift_request_dates_delete_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  IF public.regapro_shift_rpc_active() THEN
    RETURN OLD;
  END IF;
  SELECT status INTO v_status
  FROM public.shift_requests
  WHERE id = OLD.shift_request_id;
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'SHIFT_REQUEST_IMMUTABLE: submitted request dates cannot be changed';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_shift_request_dates_delete_guard
  BEFORE DELETE ON public.shift_request_dates
  FOR EACH ROW EXECUTE FUNCTION public.regapro_shift_request_dates_delete_guard();

CREATE OR REPLACE FUNCTION public.regapro_shift_request_mutation_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.regapro_shift_rpc_active() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'SHIFT_REQUEST_IMMUTABLE: only draft requests may be edited';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'SHIFT_INVALID_TRANSITION: status changes must go through RPC';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.org_id IS DISTINCT FROM OLD.org_id
    OR NEW.staff_id IS DISTINCT FROM OLD.staff_id
  ) THEN
    RAISE EXCEPTION 'SHIFT_REQUEST_IMMUTABLE: staff_id and org_id cannot change';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_shift_request_mutation_guard
  BEFORE UPDATE ON public.shift_requests
  FOR EACH ROW EXECUTE FUNCTION public.regapro_shift_request_mutation_guard();

CREATE OR REPLACE FUNCTION public.regapro_shift_mutation_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.regapro_shift_rpc_active() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'SHIFT_IMMUTABLE: published and cancelled shifts cannot be edited in place';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'SHIFT_INVALID_TRANSITION: status changes must go through RPC';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.org_id IS DISTINCT FROM OLD.org_id
    OR NEW.staff_id IS DISTINCT FROM OLD.staff_id
  ) THEN
    RAISE EXCEPTION 'SHIFT_IMMUTABLE: staff_id and org_id cannot change';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_shift_mutation_guard
  BEFORE UPDATE ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.regapro_shift_mutation_guard();

CREATE OR REPLACE FUNCTION public.regapro_shift_request_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff_org uuid;
  v_requested_org uuid;
  v_prev public.shift_requests;
BEGIN
  SELECT org_id INTO v_staff_org FROM public.staff WHERE staff_id = NEW.staff_id;
  IF v_staff_org IS DISTINCT FROM NEW.org_id THEN
    RAISE EXCEPTION 'SHIFT_CROSS_ORG: staff_id must belong to the request org';
  END IF;

  SELECT org_id INTO v_requested_org
  FROM public.staff
  WHERE staff_id = NEW.requested_by_staff_id;
  IF v_requested_org IS DISTINCT FROM NEW.org_id THEN
    RAISE EXCEPTION 'SHIFT_CROSS_ORG: requested_by_staff_id must belong to the request org';
  END IF;

  IF NEW.previous_request_id IS NOT NULL THEN
    SELECT * INTO v_prev
    FROM public.shift_requests
    WHERE id = NEW.previous_request_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SHIFT_NOT_FOUND: previous request';
    END IF;
    IF v_prev.org_id IS DISTINCT FROM NEW.org_id
      OR v_prev.staff_id IS DISTINCT FROM NEW.staff_id
      OR v_prev.period_start IS DISTINCT FROM NEW.period_start
      OR v_prev.period_end IS DISTINCT FROM NEW.period_end
      OR v_prev.version >= NEW.version THEN
      RAISE EXCEPTION 'SHIFT_CROSS_ORG: previous_request_id must be an older version of the same staff period';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_shift_request_integrity
  BEFORE INSERT OR UPDATE ON public.shift_requests
  FOR EACH ROW EXECUTE FUNCTION public.regapro_shift_request_integrity();

CREATE OR REPLACE FUNCTION public.regapro_shift_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff_org uuid;
  v_date public.shift_request_dates;
  v_parent public.shift_requests;
  v_actor_org uuid;
BEGIN
  SELECT org_id INTO v_staff_org FROM public.staff WHERE staff_id = NEW.staff_id;
  IF v_staff_org IS DISTINCT FROM NEW.org_id THEN
    RAISE EXCEPTION 'SHIFT_CROSS_ORG: staff_id must belong to the shift org';
  END IF;

  IF NEW.work_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.work_locations wl
    WHERE wl.id = NEW.work_location_id
      AND wl.org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION 'SHIFT_CROSS_ORG: work_location_id must belong to the same org';
  END IF;

  IF NEW.source_request_date_id IS NOT NULL THEN
    SELECT * INTO v_date
    FROM public.shift_request_dates
    WHERE id = NEW.source_request_date_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SHIFT_NOT_FOUND: source request date';
    END IF;
    IF v_date.org_id IS DISTINCT FROM NEW.org_id THEN
      RAISE EXCEPTION 'SHIFT_CROSS_ORG: source_request_date_id must belong to the same org';
    END IF;
    IF v_date.work_date IS DISTINCT FROM NEW.work_date THEN
      RAISE EXCEPTION 'SHIFT_CROSS_ORG: source_request_date work_date must match the shift';
    END IF;
    SELECT * INTO v_parent
    FROM public.shift_requests
    WHERE id = v_date.shift_request_id;
    IF NOT FOUND OR v_parent.staff_id IS DISTINCT FROM NEW.staff_id THEN
      RAISE EXCEPTION 'SHIFT_CROSS_ORG: source request staff_id must match the shift';
    END IF;
  END IF;

  IF NEW.published_by_staff_id IS NOT NULL THEN
    SELECT org_id INTO v_actor_org
    FROM public.staff
    WHERE staff_id = NEW.published_by_staff_id;
    IF v_actor_org IS DISTINCT FROM NEW.org_id THEN
      RAISE EXCEPTION 'SHIFT_CROSS_ORG: published_by_staff_id must belong to the same org';
    END IF;
  END IF;

  IF NEW.cancelled_by_staff_id IS NOT NULL THEN
    SELECT org_id INTO v_actor_org
    FROM public.staff
    WHERE staff_id = NEW.cancelled_by_staff_id;
    IF v_actor_org IS DISTINCT FROM NEW.org_id THEN
      RAISE EXCEPTION 'SHIFT_CROSS_ORG: cancelled_by_staff_id must belong to the same org';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_shift_integrity
  BEFORE INSERT OR UPDATE ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.regapro_shift_integrity();

-- ---------------------------------------------------------------------------
-- Lifecycle RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_or_replace_shift_request_draft(
  p_period_start date,
  p_period_end date,
  p_dates jsonb DEFAULT '[]'::jsonb,
  p_for_staff_id uuid DEFAULT NULL
)
RETURNS public.shift_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_org uuid;
  v_target uuid;
  v_req public.shift_requests;
  v_version integer;
  v_item jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'SHIFT_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  IF p_period_end < p_period_start THEN
    RAISE EXCEPTION 'SHIFT_INVALID_PERIOD: period_end must be on or after period_start';
  END IF;

  SELECT s.org_id INTO v_org
  FROM public.staff s
  WHERE s.staff_id = v_actor AND s.status = 'active';

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'SHIFT_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;

  v_target := COALESCE(p_for_staff_id, v_actor);
  IF v_target <> v_actor AND NOT public.regapro_staff_has_permission(v_org, 'shift.manage') THEN
    RAISE EXCEPTION 'SHIFT_FORBIDDEN: cannot create a request for another staff' USING ERRCODE = '42501';
  END IF;
  IF v_target = v_actor AND NOT (
    public.regapro_staff_has_permission(v_org, 'shift.request')
    OR public.regapro_staff_has_permission(v_org, 'shift.manage')
  ) THEN
    RAISE EXCEPTION 'SHIFT_FORBIDDEN: shift.request required' USING ERRCODE = '42501';
  END IF;
  IF v_target <> v_actor AND NOT EXISTS (
    SELECT 1 FROM public.staff s
    WHERE s.staff_id = v_target AND s.org_id = v_org
  ) THEN
    RAISE EXCEPTION 'SHIFT_NOT_FOUND: staff';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      v_org::text || ':' || v_target::text || ':' || p_period_start::text || ':' || p_period_end::text,
      882751
    )
  );

  PERFORM set_config('regapro.shift_rpc', '1', true);

  SELECT * INTO v_req
  FROM public.shift_requests
  WHERE org_id = v_org
    AND staff_id = v_target
    AND period_start = p_period_start
    AND period_end = p_period_end
    AND status = 'draft'
  ORDER BY version DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    DELETE FROM public.shift_request_dates WHERE shift_request_id = v_req.id;
    UPDATE public.shift_requests
      SET requested_by_staff_id = v_actor
      WHERE id = v_req.id
      RETURNING * INTO v_req;
  ELSE
    SELECT COALESCE(MAX(version), 0) + 1 INTO v_version
    FROM public.shift_requests
    WHERE org_id = v_org
      AND staff_id = v_target
      AND period_start = p_period_start;

    INSERT INTO public.shift_requests (
      org_id, staff_id, period_start, period_end, version,
      status, requested_by_staff_id
    ) VALUES (
      v_org, v_target, p_period_start, p_period_end, v_version,
      'draft', v_actor
    )
    RETURNING * INTO v_req;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_dates, '[]'::jsonb))
  LOOP
    INSERT INTO public.shift_request_dates (
      shift_request_id,
      org_id,
      work_date,
      preference_type,
      start_time,
      end_time,
      work_location_id,
      note
    ) VALUES (
      v_req.id,
      v_org,
      (v_item->>'work_date')::date,
      v_item->>'preference_type',
      NULLIF(v_item->>'start_time', '')::time,
      NULLIF(v_item->>'end_time', '')::time,
      NULLIF(v_item->>'work_location_id', '')::uuid,
      NULLIF(v_item->>'note', '')
    );
  END LOOP;

  RETURN v_req;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_shift_request(p_request_id uuid)
RETURNS public.shift_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_req public.shift_requests;
  v_old public.shift_requests;
  v_supersede_id uuid := NULL;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'SHIFT_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('regapro.shift_rpc', '1', true);

  SELECT * INTO v_req
  FROM public.shift_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SHIFT_NOT_FOUND: request';
  END IF;

  IF NOT public.regapro_staff_belongs_to_org(v_req.org_id) THEN
    RAISE EXCEPTION 'SHIFT_FORBIDDEN: org' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    (v_req.staff_id = v_actor AND public.regapro_staff_has_permission(v_req.org_id, 'shift.request'))
    OR public.regapro_staff_has_permission(v_req.org_id, 'shift.manage')
  ) THEN
    RAISE EXCEPTION 'SHIFT_FORBIDDEN: shift.request required' USING ERRCODE = '42501';
  END IF;

  IF v_req.status = 'submitted' THEN
    RETURN v_req;
  END IF;

  IF v_req.status IN ('superseded', 'cancelled') THEN
    RAISE EXCEPTION 'SHIFT_INVALID_TRANSITION: cannot submit a % request', v_req.status;
  END IF;

  FOR v_old IN
    SELECT *
    FROM public.shift_requests
    WHERE org_id = v_req.org_id
      AND staff_id = v_req.staff_id
      AND period_start = v_req.period_start
      AND period_end = v_req.period_end
      AND status = 'submitted'
      AND id <> v_req.id
    FOR UPDATE
  LOOP
    UPDATE public.shift_requests
      SET status = 'superseded'
      WHERE id = v_old.id;
    v_supersede_id := v_old.id;
    PERFORM public.regapro_write_shift_audit(
      v_old.org_id,
      'shift_request_superseded',
      'shift_request',
      v_old.id,
      v_actor,
      v_old.staff_id,
      jsonb_build_object('before_status', 'submitted', 'after_status', 'superseded', 'replaced_by', v_req.id)
    );
  END LOOP;

  UPDATE public.shift_requests
    SET status = 'submitted',
        submitted_at = now(),
        previous_request_id = COALESCE(previous_request_id, v_supersede_id)
    WHERE id = v_req.id
    RETURNING * INTO v_req;

  PERFORM public.regapro_write_shift_audit(
    v_req.org_id,
    'shift_request_submitted',
    'shift_request',
    v_req.id,
    v_actor,
    v_req.staff_id,
    jsonb_build_object(
      'before_status', 'draft',
      'after_status', 'submitted',
      'superseded_request_id', v_supersede_id
    )
  );

  RETURN v_req;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_shift_request(p_request_id uuid)
RETURNS public.shift_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_req public.shift_requests;
  v_before text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'SHIFT_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('regapro.shift_rpc', '1', true);

  SELECT * INTO v_req
  FROM public.shift_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SHIFT_NOT_FOUND: request';
  END IF;

  IF NOT public.regapro_staff_belongs_to_org(v_req.org_id) THEN
    RAISE EXCEPTION 'SHIFT_FORBIDDEN: org' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    (v_req.staff_id = v_actor AND public.regapro_staff_has_permission(v_req.org_id, 'shift.request'))
    OR public.regapro_staff_has_permission(v_req.org_id, 'shift.manage')
  ) THEN
    RAISE EXCEPTION 'SHIFT_FORBIDDEN: shift.request required' USING ERRCODE = '42501';
  END IF;

  IF v_req.status = 'cancelled' THEN
    RETURN v_req;
  END IF;

  IF v_req.status = 'superseded' THEN
    RAISE EXCEPTION 'SHIFT_INVALID_TRANSITION: cannot cancel a superseded request';
  END IF;

  v_before := v_req.status;

  UPDATE public.shift_requests
    SET status = 'cancelled',
        cancelled_at = now()
    WHERE id = v_req.id
    RETURNING * INTO v_req;

  PERFORM public.regapro_write_shift_audit(
    v_req.org_id,
    'shift_request_cancelled',
    'shift_request',
    v_req.id,
    v_actor,
    v_req.staff_id,
    jsonb_build_object('before_status', v_before, 'after_status', 'cancelled')
  );

  RETURN v_req;
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_shift(p_shift_id uuid)
RETURNS public.shifts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_shift public.shifts;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'SHIFT_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('regapro.shift_rpc', '1', true);

  SELECT * INTO v_shift
  FROM public.shifts
  WHERE id = p_shift_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SHIFT_NOT_FOUND: shift';
  END IF;

  IF NOT public.regapro_staff_belongs_to_org(v_shift.org_id) THEN
    RAISE EXCEPTION 'SHIFT_FORBIDDEN: org' USING ERRCODE = '42501';
  END IF;

  IF NOT public.regapro_staff_has_permission(v_shift.org_id, 'shift.manage') THEN
    RAISE EXCEPTION 'SHIFT_FORBIDDEN: shift.manage required' USING ERRCODE = '42501';
  END IF;

  IF v_shift.status = 'published' THEN
    RETURN v_shift;
  END IF;

  IF v_shift.status <> 'draft' THEN
    RAISE EXCEPTION 'SHIFT_INVALID_TRANSITION: cannot publish a % shift', v_shift.status;
  END IF;

  UPDATE public.shifts
    SET status = 'published',
        published_at = now(),
        published_by_staff_id = v_actor
    WHERE id = v_shift.id
    RETURNING * INTO v_shift;

  PERFORM public.regapro_write_shift_audit(
    v_shift.org_id,
    'shift_published',
    'shift',
    v_shift.id,
    v_actor,
    v_shift.staff_id,
    jsonb_build_object('before_status', 'draft', 'after_status', 'published')
  );

  RETURN v_shift;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_shift(p_shift_id uuid)
RETURNS public.shifts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_shift public.shifts;
  v_before text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'SHIFT_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('regapro.shift_rpc', '1', true);

  SELECT * INTO v_shift
  FROM public.shifts
  WHERE id = p_shift_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SHIFT_NOT_FOUND: shift';
  END IF;

  IF NOT public.regapro_staff_belongs_to_org(v_shift.org_id) THEN
    RAISE EXCEPTION 'SHIFT_FORBIDDEN: org' USING ERRCODE = '42501';
  END IF;

  IF NOT public.regapro_staff_has_permission(v_shift.org_id, 'shift.manage') THEN
    RAISE EXCEPTION 'SHIFT_FORBIDDEN: shift.manage required' USING ERRCODE = '42501';
  END IF;

  IF v_shift.status = 'cancelled' THEN
    RETURN v_shift;
  END IF;

  v_before := v_shift.status;

  UPDATE public.shifts
    SET status = 'cancelled',
        cancelled_at = now(),
        cancelled_by_staff_id = v_actor
    WHERE id = v_shift.id
    RETURNING * INTO v_shift;

  PERFORM public.regapro_write_shift_audit(
    v_shift.org_id,
    'shift_cancelled',
    'shift',
    v_shift.id,
    v_actor,
    v_shift.staff_id,
    jsonb_build_object('before_status', v_before, 'after_status', 'cancelled')
  );

  RETURN v_shift;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE ON TABLE public.work_locations TO authenticated;
GRANT SELECT ON TABLE public.shift_requests TO authenticated;
GRANT SELECT ON TABLE public.shift_request_dates TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.shifts TO authenticated;

GRANT ALL ON TABLE public.work_locations TO service_role;
GRANT ALL ON TABLE public.shift_requests TO service_role;
GRANT ALL ON TABLE public.shift_request_dates TO service_role;
GRANT ALL ON TABLE public.shifts TO service_role;

REVOKE ALL ON FUNCTION public.regapro_has_any_shift_permission(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_shift_rpc_active() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_touch_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_shift_request_date_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_shift_request_dates_delete_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_shift_request_mutation_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_shift_mutation_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_shift_request_integrity() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_shift_integrity() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_write_shift_audit(uuid, text, text, uuid, uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_or_replace_shift_request_draft(date, date, jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_shift_request(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_shift_request(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publish_shift(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_shift(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.regapro_has_any_shift_permission(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.regapro_has_any_shift_permission(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_or_replace_shift_request_draft(date, date, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_shift_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_shift_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_shift(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_shift(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.work_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_request_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY work_locations_select ON public.work_locations
  FOR SELECT USING (
    deleted_at IS NULL
    AND public.regapro_staff_belongs_to_org(org_id)
    AND (
      (is_active AND public.regapro_has_any_shift_permission(org_id))
      OR public.regapro_staff_has_permission(org_id, 'shift.manage')
    )
  );

CREATE POLICY work_locations_insert ON public.work_locations
  FOR INSERT WITH CHECK (
    public.regapro_staff_has_permission(org_id, 'shift.manage')
  );

CREATE POLICY work_locations_update ON public.work_locations
  FOR UPDATE USING (
    public.regapro_staff_has_permission(org_id, 'shift.manage')
  ) WITH CHECK (
    public.regapro_staff_has_permission(org_id, 'shift.manage')
  );

CREATE POLICY shift_requests_select ON public.shift_requests
  FOR SELECT USING (
    public.regapro_staff_belongs_to_org(org_id)
    AND (
      (
        staff_id = public.regapro_current_staff_id()
        AND public.regapro_staff_has_permission(org_id, 'shift.request')
      )
      OR public.regapro_staff_has_permission(org_id, 'shift.manage')
    )
  );

CREATE POLICY shift_request_dates_select ON public.shift_request_dates
  FOR SELECT USING (
    public.regapro_staff_belongs_to_org(org_id)
    AND EXISTS (
      SELECT 1
      FROM public.shift_requests r
      WHERE r.id = shift_request_id
        AND r.org_id = org_id
        AND (
          (
            r.staff_id = public.regapro_current_staff_id()
            AND public.regapro_staff_has_permission(org_id, 'shift.request')
          )
          OR public.regapro_staff_has_permission(org_id, 'shift.manage')
        )
    )
  );

CREATE POLICY shifts_select ON public.shifts
  FOR SELECT USING (
    public.regapro_staff_belongs_to_org(org_id)
    AND (
      (
        staff_id = public.regapro_current_staff_id()
        AND status = 'published'
        AND public.regapro_staff_has_permission(org_id, 'shift.view_own')
      )
      OR public.regapro_staff_has_permission(org_id, 'shift.manage')
    )
  );

CREATE POLICY shifts_insert ON public.shifts
  FOR INSERT WITH CHECK (
    public.regapro_staff_belongs_to_org(org_id)
    AND status = 'draft'
    AND public.regapro_staff_has_permission(org_id, 'shift.manage')
  );

CREATE POLICY shifts_update ON public.shifts
  FOR UPDATE USING (
    public.regapro_staff_belongs_to_org(org_id)
    AND status = 'draft'
    AND public.regapro_staff_has_permission(org_id, 'shift.manage')
  ) WITH CHECK (
    public.regapro_staff_belongs_to_org(org_id)
    AND status = 'draft'
    AND public.regapro_staff_has_permission(org_id, 'shift.manage')
  );
