
CREATE OR REPLACE FUNCTION public.regapro_expense_append_version(
  p_app public.expense_applications,
  p_actor uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.expense_application_versions (
    application_id, org_id, version_no, application_type, category_id,
    amount_yen, expense_date, description, file_object_id, created_by_staff_id
  ) VALUES (
    p_app.id, p_app.org_id, p_app.current_version_no, p_app.application_type, p_app.category_id,
    p_app.amount_yen, p_app.expense_date, p_app.description, p_app.file_object_id, p_actor
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_expense_application_draft(
  p_application_id uuid,
  p_staff_id uuid,
  p_application_type text,
  p_category_id uuid,
  p_amount_yen integer,
  p_expense_date date,
  p_description text
) RETURNS public.expense_applications
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_org uuid;
  v_target uuid;
  v_app public.expense_applications;
  v_next_version integer;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'EXPENSE_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('regapro.expense_rpc', '1', true);
  SELECT s.org_id INTO v_org FROM public.staff s
  WHERE s.staff_id = v_actor AND s.status = 'active';
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'EXPENSE_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  v_target := COALESCE(p_staff_id, v_actor);
  IF v_target <> v_actor AND NOT public.regapro_staff_has_permission(v_org, 'expense.manage') THEN
    RAISE EXCEPTION 'EXPENSE_FORBIDDEN: cannot draft for another staff' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    public.regapro_staff_has_permission(v_org, 'expense.submit')
    OR public.regapro_staff_has_permission(v_org, 'expense.manage')
  ) THEN
    RAISE EXCEPTION 'EXPENSE_FORBIDDEN: expense.submit required' USING ERRCODE = '42501';
  END IF;
  IF p_amount_yen IS NULL OR p_amount_yen <= 0 THEN
    RAISE EXCEPTION 'EXPENSE_INVALID_AMOUNT: amount must be positive';
  END IF;
  IF p_application_type NOT IN ('advance', 'after') THEN
    RAISE EXCEPTION 'EXPENSE_VALIDATION: invalid application_type';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.expense_categories c
    WHERE c.id = p_category_id AND c.org_id = v_org AND c.active
  ) THEN
    RAISE EXCEPTION 'EXPENSE_NOT_FOUND: category';
  END IF;

  IF p_application_id IS NULL THEN
    INSERT INTO public.expense_applications (
      org_id, staff_id, status, current_version_no, application_type, category_id,
      amount_yen, expense_date, description, created_by_staff_id
    ) VALUES (
      v_org, v_target, 'draft', 1, p_application_type, p_category_id,
      p_amount_yen, p_expense_date, trim(p_description), v_actor
    ) RETURNING * INTO v_app;
    PERFORM public.regapro_expense_append_version(v_app, v_actor);
  ELSE
    SELECT * INTO v_app FROM public.expense_applications WHERE id = p_application_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'EXPENSE_NOT_FOUND: expense application'; END IF;
    IF v_app.org_id <> v_org THEN
      RAISE EXCEPTION 'EXPENSE_FORBIDDEN: cross-org denied' USING ERRCODE = '42501';
    END IF;
    IF v_app.staff_id <> v_target THEN
      RAISE EXCEPTION 'EXPENSE_FORBIDDEN: staff mismatch' USING ERRCODE = '42501';
    END IF;
    IF v_app.status NOT IN ('draft', 'returned') THEN
      RAISE EXCEPTION 'EXPENSE_INVALID_TRANSITION: cannot edit from %', v_app.status;
    END IF;
    v_next_version := v_app.current_version_no + 1;
    UPDATE public.expense_applications SET
      application_type = p_application_type,
      category_id = p_category_id,
      amount_yen = p_amount_yen,
      expense_date = p_expense_date,
      description = trim(p_description),
      current_version_no = v_next_version,
      status = CASE WHEN v_app.status = 'returned' THEN 'draft' ELSE v_app.status END
    WHERE id = v_app.id
    RETURNING * INTO v_app;
    PERFORM public.regapro_expense_append_version(v_app, v_actor);
  END IF;

  PERFORM public.regapro_write_expense_event(
    v_org, 'expense_application_drafted', 'expense_application', v_app.id,
    v_actor, v_app.staff_id, jsonb_build_object('amount_yen', v_app.amount_yen)
  );
  RETURN v_app;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_expense_application(p_application_id uuid)
RETURNS public.expense_applications
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_app public.expense_applications;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'EXPENSE_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('regapro.expense_rpc', '1', true);
  SELECT * INTO v_app FROM public.expense_applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EXPENSE_NOT_FOUND: expense application'; END IF;
  IF NOT public.regapro_staff_belongs_to_org(v_app.org_id) THEN
    RAISE EXCEPTION 'EXPENSE_FORBIDDEN: cross-org denied' USING ERRCODE = '42501';
  END IF;
  IF v_app.staff_id <> v_actor AND NOT public.regapro_staff_has_permission(v_app.org_id, 'expense.manage') THEN
    RAISE EXCEPTION 'EXPENSE_FORBIDDEN: cannot submit for another staff' USING ERRCODE = '42501';
  END IF;
  IF v_app.status NOT IN ('draft', 'returned') THEN
    RAISE EXCEPTION 'EXPENSE_INVALID_TRANSITION: cannot submit from %', v_app.status;
  END IF;
  UPDATE public.expense_applications SET
    status = 'pending',
    submitted_at = now(),
    submitted_by_staff_id = v_actor,
    returned_at = NULL,
    returned_by_staff_id = NULL,
    return_reason = NULL,
    approved_at = NULL,
    approved_by_staff_id = NULL
  WHERE id = v_app.id RETURNING * INTO v_app;
  PERFORM public.regapro_write_expense_event(
    v_app.org_id, 'expense_application_submitted', 'expense_application', v_app.id,
    v_actor, v_app.staff_id, jsonb_build_object('amount_yen', v_app.amount_yen)
  );
  RETURN v_app;
END;
$$;

CREATE OR REPLACE FUNCTION public.return_expense_application(p_application_id uuid, p_reason text)
RETURNS public.expense_applications
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_app public.expense_applications;
  v_reason text := trim(p_reason);
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'EXPENSE_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('regapro.expense_rpc', '1', true);
  IF char_length(v_reason) < 3 THEN
    RAISE EXCEPTION 'EXPENSE_INVALID_REASON: return reason too short';
  END IF;
  SELECT * INTO v_app FROM public.expense_applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EXPENSE_NOT_FOUND: expense application'; END IF;
  IF NOT public.regapro_staff_has_permission(v_app.org_id, 'expense.manage') THEN
    RAISE EXCEPTION 'EXPENSE_FORBIDDEN: expense.manage required' USING ERRCODE = '42501';
  END IF;
  IF v_app.staff_id = v_actor THEN
    RAISE EXCEPTION 'EXPENSE_SELF_REVIEW: cannot review own expense application';
  END IF;
  IF v_app.status <> 'pending' THEN
    RAISE EXCEPTION 'EXPENSE_INVALID_TRANSITION: cannot return from %', v_app.status;
  END IF;
  UPDATE public.expense_applications SET
    status = 'returned',
    returned_at = now(),
    returned_by_staff_id = v_actor,
    return_reason = v_reason
  WHERE id = v_app.id RETURNING * INTO v_app;
  PERFORM public.regapro_write_expense_event(
    v_app.org_id, 'expense_application_returned', 'expense_application', v_app.id,
    v_actor, v_app.staff_id, jsonb_build_object('reason', v_reason)
  );
  RETURN v_app;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_expense_application(p_application_id uuid)
RETURNS public.expense_applications
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_app public.expense_applications;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'EXPENSE_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('regapro.expense_rpc', '1', true);
  SELECT * INTO v_app FROM public.expense_applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EXPENSE_NOT_FOUND: expense application'; END IF;
  IF NOT public.regapro_staff_has_permission(v_app.org_id, 'expense.manage') THEN
    RAISE EXCEPTION 'EXPENSE_FORBIDDEN: expense.manage required' USING ERRCODE = '42501';
  END IF;
  IF v_app.staff_id = v_actor THEN
    RAISE EXCEPTION 'EXPENSE_SELF_REVIEW: cannot review own expense application';
  END IF;
  IF v_app.status <> 'pending' THEN
    RAISE EXCEPTION 'EXPENSE_INVALID_TRANSITION: cannot approve from %', v_app.status;
  END IF;
  UPDATE public.expense_applications SET
    status = 'approved',
    approved_at = now(),
    approved_by_staff_id = v_actor
  WHERE id = v_app.id RETURNING * INTO v_app;
  PERFORM public.regapro_write_expense_event(
    v_app.org_id, 'expense_application_approved', 'expense_application', v_app.id,
    v_actor, v_app.staff_id, jsonb_build_object('amount_yen', v_app.amount_yen)
  );
  RETURN v_app;
END;
$$;

CREATE OR REPLACE FUNCTION public.attach_expense_application_receipt(
  p_application_id uuid,
  p_file_object_id uuid
) RETURNS public.expense_applications
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_app public.expense_applications;
  v_next integer;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'EXPENSE_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('regapro.expense_rpc', '1', true);
  SELECT * INTO v_app FROM public.expense_applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EXPENSE_NOT_FOUND: expense application'; END IF;
  IF v_app.status = 'approved' THEN
    RAISE EXCEPTION 'EXPENSE_INVALID_TRANSITION: approved application is immutable';
  END IF;
  IF v_app.staff_id <> v_actor AND NOT public.regapro_staff_has_permission(v_app.org_id, 'expense.manage') THEN
    RAISE EXCEPTION 'EXPENSE_FORBIDDEN: cannot attach receipt for another staff' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.file_objects fo
    WHERE fo.id = p_file_object_id AND fo.org_id = v_app.org_id AND fo.bucket = 'expense-receipts'
      AND fo.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'EXPENSE_NOT_FOUND: receipt file_object';
  END IF;
  v_next := v_app.current_version_no + 1;
  UPDATE public.expense_applications SET
    file_object_id = p_file_object_id,
    current_version_no = v_next
  WHERE id = v_app.id RETURNING * INTO v_app;
  PERFORM public.regapro_expense_append_version(v_app, v_actor);
  PERFORM public.regapro_write_expense_event(
    v_app.org_id, 'expense_receipt_attached', 'expense_application', v_app.id,
    v_actor, v_app.staff_id, jsonb_build_object('file_object_id', p_file_object_id)
  );
  RETURN v_app;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_personal_sales_case(
  p_occurred_on date,
  p_title text,
  p_total_amount_yen integer,
  p_note text,
  p_staff_id uuid,
  p_allocations jsonb,
  p_allocation_rule_version_id uuid
) RETURNS public.personal_sales_cases
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_org uuid;
  v_case public.personal_sales_cases;
  v_row jsonb;
  v_sum integer := 0;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'SALES_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('regapro.personal_sales_rpc', '1', true);
  SELECT s.org_id INTO v_org FROM public.staff s
  WHERE s.staff_id = v_actor AND s.status = 'active';
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'SALES_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  IF NOT public.regapro_staff_has_permission(v_org, 'sales.manage') THEN
    RAISE EXCEPTION 'SALES_FORBIDDEN: sales.manage required' USING ERRCODE = '42501';
  END IF;
  IF p_total_amount_yen IS NULL OR p_total_amount_yen <= 0 THEN
    RAISE EXCEPTION 'SALES_INVALID_ALLOCATION: total amount invalid';
  END IF;
  IF p_allocation_rule_version_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.personal_sales_allocation_rule_versions r
      WHERE r.id = p_allocation_rule_version_id AND r.org_id = v_org AND r.status = 'approved'
    ) THEN
      RAISE EXCEPTION 'SALES_NO_APPROVED_RULE: allocation rule must be approved';
    END IF;
  END IF;
  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_allocations, '[]'::jsonb)) LOOP
    v_sum := v_sum + (v_row->>'amountYen')::integer;
  END LOOP;
  IF v_sum <> p_total_amount_yen THEN
    RAISE EXCEPTION 'SALES_INVALID_ALLOCATION: allocation amounts must sum to total';
  END IF;

  INSERT INTO public.personal_sales_cases (
    org_id, staff_id, occurred_on, title, total_amount_yen, status, note, created_by_staff_id
  ) VALUES (
    v_org, COALESCE(p_staff_id, v_actor), p_occurred_on, trim(p_title), p_total_amount_yen, 'active', p_note, v_actor
  ) RETURNING * INTO v_case;

  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_allocations, '[]'::jsonb)) LOOP
    INSERT INTO public.personal_sales_allocations (
      case_id, org_id, staff_id, share_rate_bps, amount_yen, allocation_rule_version_id
    ) VALUES (
      v_case.id, v_org, (v_row->>'staffId')::uuid, (v_row->>'shareRateBps')::integer,
      (v_row->>'amountYen')::integer, p_allocation_rule_version_id
    );
  END LOOP;

  PERFORM public.regapro_write_personal_sales_event(
    v_org, 'personal_sales_case_created', 'personal_sales_case', v_case.id,
    v_actor, v_case.staff_id, jsonb_build_object('total_amount_yen', v_case.total_amount_yen)
  );
  RETURN v_case;
END;
$$;

CREATE OR REPLACE FUNCTION public.void_personal_sales_case(p_case_id uuid, p_reason text)
RETURNS public.personal_sales_cases
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_case public.personal_sales_cases;
BEGIN
  PERFORM set_config('regapro.personal_sales_rpc', '1', true);
  SELECT * INTO v_case FROM public.personal_sales_cases WHERE id = p_case_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SALES_NOT_FOUND: personal sales case'; END IF;
  IF NOT public.regapro_staff_has_permission(v_case.org_id, 'sales.manage') THEN
    RAISE EXCEPTION 'SALES_FORBIDDEN: sales.manage required' USING ERRCODE = '42501';
  END IF;
  IF v_case.status <> 'active' THEN
    RAISE EXCEPTION 'SALES_INVALID_TRANSITION: cannot void from %', v_case.status;
  END IF;
  UPDATE public.personal_sales_cases SET status = 'voided' WHERE id = v_case.id RETURNING * INTO v_case;
  PERFORM public.regapro_write_personal_sales_event(
    v_case.org_id, 'personal_sales_case_voided', 'personal_sales_case', v_case.id,
    v_actor, v_case.staff_id, jsonb_build_object('reason', trim(p_reason))
  );
  RETURN v_case;
END;
$$;

CREATE OR REPLACE FUNCTION public.correct_personal_sales_case(
  p_case_id uuid,
  p_occurred_on date,
  p_title text,
  p_total_amount_yen integer,
  p_note text,
  p_allocations jsonb,
  p_reason text
) RETURNS public.personal_sales_cases
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_old public.personal_sales_cases;
  v_new public.personal_sales_cases;
  v_row jsonb;
  v_sum integer := 0;
BEGIN
  PERFORM set_config('regapro.personal_sales_rpc', '1', true);
  SELECT * INTO v_old FROM public.personal_sales_cases WHERE id = p_case_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SALES_NOT_FOUND: personal sales case'; END IF;
  IF NOT public.regapro_staff_has_permission(v_old.org_id, 'sales.manage') THEN
    RAISE EXCEPTION 'SALES_FORBIDDEN: sales.manage required' USING ERRCODE = '42501';
  END IF;
  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_allocations, '[]'::jsonb)) LOOP
    v_sum := v_sum + (v_row->>'amountYen')::integer;
  END LOOP;
  IF v_sum <> p_total_amount_yen THEN
    RAISE EXCEPTION 'SALES_INVALID_ALLOCATION: allocation amounts must sum to total';
  END IF;
  UPDATE public.personal_sales_cases SET status = 'corrected' WHERE id = v_old.id;
  INSERT INTO public.personal_sales_cases (
    org_id, staff_id, occurred_on, title, total_amount_yen, status, note,
    corrected_case_id, created_by_staff_id
  ) VALUES (
    v_old.org_id, v_old.staff_id, p_occurred_on, trim(p_title), p_total_amount_yen, 'active', p_note,
    v_old.id, v_actor
  ) RETURNING * INTO v_new;
  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_allocations, '[]'::jsonb)) LOOP
    INSERT INTO public.personal_sales_allocations (
      case_id, org_id, staff_id, share_rate_bps, amount_yen
    ) VALUES (
      v_new.id, v_new.org_id, (v_row->>'staffId')::uuid, (v_row->>'shareRateBps')::integer,
      (v_row->>'amountYen')::integer
    );
  END LOOP;
  PERFORM public.regapro_write_personal_sales_event(
    v_new.org_id, 'personal_sales_case_corrected', 'personal_sales_case', v_new.id,
    v_actor, v_new.staff_id, jsonb_build_object('reason', trim(p_reason), 'from_case_id', v_old.id)
  );
  RETURN v_new;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_personal_sales_allocation_rule_draft(
  p_effective_from date,
  p_effective_to date,
  p_rule_payload jsonb
) RETURNS public.personal_sales_allocation_rule_versions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_org uuid;
  v_version integer;
  v_rule public.personal_sales_allocation_rule_versions;
BEGIN
  PERFORM set_config('regapro.personal_sales_rpc', '1', true);
  SELECT s.org_id INTO v_org FROM public.staff s
  WHERE s.staff_id = v_actor AND s.status = 'active';
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'SALES_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  IF NOT public.regapro_staff_has_permission(v_org, 'sales.manage') THEN
    RAISE EXCEPTION 'SALES_FORBIDDEN: sales.manage required' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(max(version), 0) + 1 INTO v_version
  FROM public.personal_sales_allocation_rule_versions WHERE org_id = v_org;
  INSERT INTO public.personal_sales_allocation_rule_versions (
    org_id, version, status, effective_from, effective_to, rule_payload, created_by_staff_id
  ) VALUES (
    v_org, v_version, 'draft', p_effective_from, p_effective_to, COALESCE(p_rule_payload, '{}'::jsonb), v_actor
  ) RETURNING * INTO v_rule;
  RETURN v_rule;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_personal_sales_allocation_rule(p_rule_version_id uuid)
RETURNS public.personal_sales_allocation_rule_versions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rule public.personal_sales_allocation_rule_versions;
  v_actor uuid := public.regapro_current_staff_id();
BEGIN
  PERFORM set_config('regapro.personal_sales_rpc', '1', true);
  SELECT * INTO v_rule FROM public.personal_sales_allocation_rule_versions WHERE id = p_rule_version_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SALES_NOT_FOUND: allocation rule'; END IF;
  IF NOT public.regapro_staff_has_permission(v_rule.org_id, 'sales.manage') THEN
    RAISE EXCEPTION 'SALES_FORBIDDEN: sales.manage required' USING ERRCODE = '42501';
  END IF;
  IF v_rule.status <> 'draft' THEN
    RAISE EXCEPTION 'SALES_INVALID_TRANSITION: cannot approve from %', v_rule.status;
  END IF;
  UPDATE public.personal_sales_allocation_rule_versions SET
    status = 'approved', approved_at = now(), approved_by_staff_id = v_actor
  WHERE id = v_rule.id RETURNING * INTO v_rule;
  RETURN v_rule;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_personal_sales_allocation_rule(
  p_rule_version_id uuid,
  p_reason text
) RETURNS public.personal_sales_allocation_rule_versions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rule public.personal_sales_allocation_rule_versions;
  v_actor uuid := public.regapro_current_staff_id();
BEGIN
  PERFORM set_config('regapro.personal_sales_rpc', '1', true);
  SELECT * INTO v_rule FROM public.personal_sales_allocation_rule_versions WHERE id = p_rule_version_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SALES_NOT_FOUND: allocation rule'; END IF;
  IF NOT public.regapro_staff_has_permission(v_rule.org_id, 'sales.manage') THEN
    RAISE EXCEPTION 'SALES_FORBIDDEN: sales.manage required' USING ERRCODE = '42501';
  END IF;
  IF v_rule.status <> 'approved' THEN
    RAISE EXCEPTION 'SALES_INVALID_TRANSITION: cannot revoke from %', v_rule.status;
  END IF;
  UPDATE public.personal_sales_allocation_rule_versions SET
    status = 'revoked', revoked_at = now(), revoked_by_staff_id = v_actor, revoke_reason = trim(p_reason)
  WHERE id = v_rule.id RETURNING * INTO v_rule;
  RETURN v_rule;
END;
$$;

ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_application_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_sales_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_sales_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_sales_allocation_rule_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_sales_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY expense_categories_select ON public.expense_categories
  FOR SELECT TO authenticated
  USING (public.regapro_has_any_expense_permission(org_id));

CREATE POLICY expense_applications_select ON public.expense_applications
  FOR SELECT TO authenticated
  USING (
    public.regapro_staff_belongs_to_org(org_id)
    AND (
      staff_id = public.regapro_current_staff_id()
      OR public.regapro_staff_has_permission(org_id, 'expense.manage')
    )
  );

CREATE POLICY expense_application_versions_select ON public.expense_application_versions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.expense_applications ea
      WHERE ea.id = expense_application_versions.application_id
        AND public.regapro_staff_belongs_to_org(ea.org_id)
        AND (
          ea.staff_id = public.regapro_current_staff_id()
          OR public.regapro_staff_has_permission(ea.org_id, 'expense.manage')
        )
    )
  );

CREATE POLICY expense_events_select ON public.expense_events
  FOR SELECT TO authenticated
  USING (public.regapro_staff_has_permission(org_id, 'expense.manage'));

CREATE POLICY personal_sales_cases_select ON public.personal_sales_cases
  FOR SELECT TO authenticated
  USING (
    public.regapro_staff_belongs_to_org(org_id)
    AND (
      public.regapro_staff_has_permission(org_id, 'sales.manage')
      OR staff_id = public.regapro_current_staff_id()
      OR EXISTS (
        SELECT 1 FROM public.personal_sales_allocations a
        WHERE a.case_id = personal_sales_cases.id
          AND a.staff_id = public.regapro_current_staff_id()
      )
    )
  );

CREATE POLICY personal_sales_allocations_select ON public.personal_sales_allocations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.personal_sales_cases c
      WHERE c.id = personal_sales_allocations.case_id
        AND public.regapro_staff_belongs_to_org(c.org_id)
        AND (
          public.regapro_staff_has_permission(c.org_id, 'sales.manage')
          OR c.staff_id = public.regapro_current_staff_id()
          OR personal_sales_allocations.staff_id = public.regapro_current_staff_id()
        )
    )
  );

CREATE POLICY personal_sales_rules_select ON public.personal_sales_allocation_rule_versions
  FOR SELECT TO authenticated
  USING (public.regapro_staff_has_permission(org_id, 'sales.manage'));

CREATE POLICY personal_sales_events_select ON public.personal_sales_events
  FOR SELECT TO authenticated
  USING (public.regapro_staff_has_permission(org_id, 'sales.manage'));

GRANT SELECT ON TABLE public.expense_categories TO authenticated;
GRANT SELECT ON TABLE public.expense_applications TO authenticated;
GRANT SELECT ON TABLE public.expense_application_versions TO authenticated;
GRANT SELECT ON TABLE public.expense_events TO authenticated;
GRANT SELECT ON TABLE public.personal_sales_cases TO authenticated;
GRANT SELECT ON TABLE public.personal_sales_allocations TO authenticated;
GRANT SELECT ON TABLE public.personal_sales_allocation_rule_versions TO authenticated;
GRANT SELECT ON TABLE public.personal_sales_events TO authenticated;

GRANT ALL ON TABLE public.expense_categories TO service_role;
GRANT ALL ON TABLE public.expense_applications TO service_role;
GRANT ALL ON TABLE public.expense_application_versions TO service_role;
GRANT ALL ON TABLE public.expense_events TO service_role;
GRANT ALL ON TABLE public.personal_sales_cases TO service_role;
GRANT ALL ON TABLE public.personal_sales_allocations TO service_role;
GRANT ALL ON TABLE public.personal_sales_allocation_rule_versions TO service_role;
GRANT ALL ON TABLE public.personal_sales_events TO service_role;

REVOKE ALL ON FUNCTION public.upsert_expense_application_draft(uuid, uuid, text, uuid, integer, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_expense_application(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.return_expense_application(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_expense_application(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.attach_expense_application_receipt(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_personal_sales_case(date, text, integer, text, uuid, jsonb, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.void_personal_sales_case(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.correct_personal_sales_case(uuid, date, text, integer, text, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.upsert_personal_sales_allocation_rule_draft(date, date, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_personal_sales_allocation_rule(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_personal_sales_allocation_rule(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.regapro_has_any_expense_permission(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.regapro_has_any_sales_permission(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.upsert_expense_application_draft(uuid, uuid, text, uuid, integer, date, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_expense_application(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.return_expense_application(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_expense_application(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.attach_expense_application_receipt(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_personal_sales_case(date, text, integer, text, uuid, jsonb, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.void_personal_sales_case(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.correct_personal_sales_case(uuid, date, text, integer, text, jsonb, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_personal_sales_allocation_rule_draft(date, date, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_personal_sales_allocation_rule(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_personal_sales_allocation_rule(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regapro_has_any_expense_permission(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regapro_has_any_sales_permission(uuid) TO authenticated, service_role;
