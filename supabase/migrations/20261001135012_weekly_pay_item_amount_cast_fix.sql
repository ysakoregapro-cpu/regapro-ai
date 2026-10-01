-- Phase 4 follow-up: cast window eligible_minutes (bigint) to integer for item_amount.

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
  DELETE FROM _wp_calc WHERE TRUE; -- pg-safeupdate (PostgREST)

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
    s.eligible_minutes::integer,
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

