-- Phase 8.1: atomic legacy import RPCs + migration identity hardening.
-- Forward-only. service_role EXECUTE only for import RPCs.

-- ---------------------------------------------------------------------------
-- created_by may be NULL for system migration rows (never invent operators).
-- ---------------------------------------------------------------------------
ALTER TABLE public.expense_applications
  ALTER COLUMN created_by_staff_id DROP NOT NULL;

ALTER TABLE public.personal_sales_cases
  ALTER COLUMN created_by_staff_id DROP NOT NULL;

ALTER TABLE public.expense_applications
  DROP CONSTRAINT IF EXISTS expense_applications_migration_created_by_check;
ALTER TABLE public.expense_applications
  ADD CONSTRAINT expense_applications_migration_created_by_check
  CHECK (
    created_by_staff_id IS NOT NULL
    OR migration_import_batch_id IS NOT NULL
  );

ALTER TABLE public.personal_sales_cases
  DROP CONSTRAINT IF EXISTS personal_sales_cases_migration_created_by_check;
ALTER TABLE public.personal_sales_cases
  ADD CONSTRAINT personal_sales_cases_migration_created_by_check
  CHECK (
    created_by_staff_id IS NOT NULL
    OR migration_import_batch_id IS NOT NULL
  );

-- ---------------------------------------------------------------------------
-- Idempotent event keys (legacy event id).
-- ---------------------------------------------------------------------------
ALTER TABLE public.expense_events
  ADD COLUMN IF NOT EXISTS migration_external_id text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_events_migration_external
  ON public.expense_events (org_id, migration_external_id)
  WHERE migration_external_id IS NOT NULL;

ALTER TABLE public.personal_sales_events
  ADD COLUMN IF NOT EXISTS migration_external_id text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_personal_sales_events_migration_external
  ON public.personal_sales_events (org_id, migration_external_id)
  WHERE migration_external_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Identity match methods: email is candidate-only unless confirmed separately.
-- ---------------------------------------------------------------------------
ALTER TABLE public.migration_identity_matches
  DROP CONSTRAINT IF EXISTS migration_identity_matches_match_method_check;
ALTER TABLE public.migration_identity_matches
  ADD CONSTRAINT migration_identity_matches_match_method_check
  CHECK (match_method IN (
    'staff_no', 'email', 'name', 'manual', 'existing_identity',
    'auth_user_id', 'email_verified_candidate'
  ));

-- ---------------------------------------------------------------------------
-- Service-role gate
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.regapro_require_service_role()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'MIGRATION_FORBIDDEN: service_role required'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.regapro_require_service_role() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.regapro_require_service_role() TO service_role;

CREATE OR REPLACE FUNCTION public.regapro_migration_require_positive_yen(p_label text, p_value numeric)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v numeric := p_value;
BEGIN
  IF v IS NULL THEN
    RAISE EXCEPTION 'MIGRATION_INVALID_AMOUNT: % is null', p_label;
  END IF;
  IF v <> trunc(v) THEN
    RAISE EXCEPTION 'MIGRATION_INVALID_AMOUNT: % is not an integer yen value (%)', p_label, v;
  END IF;
  IF v <= 0 THEN
    RAISE EXCEPTION 'MIGRATION_INVALID_AMOUNT: % must be > 0 (%)', p_label, v;
  END IF;
  IF v > 2147483647 THEN
    RAISE EXCEPTION 'MIGRATION_INVALID_AMOUNT: % overflows int (%)', p_label, v;
  END IF;
  RETURN v::integer;
END;
$$;

CREATE OR REPLACE FUNCTION public.regapro_migration_require_nonneg_yen(p_label text, p_value numeric)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v numeric := p_value;
BEGIN
  IF v IS NULL THEN
    RAISE EXCEPTION 'MIGRATION_INVALID_AMOUNT: % is null', p_label;
  END IF;
  IF v <> trunc(v) THEN
    RAISE EXCEPTION 'MIGRATION_INVALID_AMOUNT: % is not an integer yen value (%)', p_label, v;
  END IF;
  IF v < 0 THEN
    RAISE EXCEPTION 'MIGRATION_INVALID_AMOUNT: % must be >= 0 (%)', p_label, v;
  END IF;
  IF v > 2147483647 THEN
    RAISE EXCEPTION 'MIGRATION_INVALID_AMOUNT: % overflows int (%)', p_label, v;
  END IF;
  RETURN v::integer;
END;
$$;

CREATE OR REPLACE FUNCTION public.regapro_migration_require_rate_bps(p_label text, p_rate numeric)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v numeric := p_rate;
  bps integer;
BEGIN
  IF v IS NULL THEN
    RAISE EXCEPTION 'MIGRATION_INVALID_RATE: % is null', p_label;
  END IF;
  IF v < 0 THEN
    RAISE EXCEPTION 'MIGRATION_INVALID_RATE: % negative (%)', p_label, v;
  END IF;
  IF v <= 1 THEN
    bps := round(v * 10000)::integer;
  ELSIF v <= 100 THEN
    bps := round(v * 100)::integer;
  ELSE
    RAISE EXCEPTION 'MIGRATION_INVALID_RATE: % out of range (%)', p_label, v;
  END IF;
  IF bps < 0 OR bps > 10000 THEN
    RAISE EXCEPTION 'MIGRATION_INVALID_RATE: % bps out of range (%)', p_label, bps;
  END IF;
  RETURN bps;
END;
$$;

REVOKE ALL ON FUNCTION public.regapro_migration_require_positive_yen(text, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.regapro_migration_require_nonneg_yen(text, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.regapro_migration_require_rate_bps(text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.regapro_migration_require_positive_yen(text, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.regapro_migration_require_nonneg_yen(text, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.regapro_migration_require_rate_bps(text, numeric) TO service_role;

-- ---------------------------------------------------------------------------
-- Category upsert
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.regapro_service_import_expense_category(
  p_org_id uuid,
  p_code text,
  p_name text,
  p_sort_order integer,
  p_active boolean
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM public.regapro_require_service_role();
  PERFORM set_config('regapro.expense_rpc', '1', true);
  IF p_org_id IS NULL OR coalesce(trim(p_code), '') = '' OR coalesce(trim(p_name), '') = '' THEN
    RAISE EXCEPTION 'MIGRATION_INVALID_CATEGORY: code/name/org required';
  END IF;
  INSERT INTO public.expense_categories (org_id, code, name, sort_order, active)
  VALUES (p_org_id, trim(p_code), trim(p_name), coalesce(p_sort_order, 0), coalesce(p_active, true))
  ON CONFLICT (org_id, code) DO UPDATE
    SET name = EXCLUDED.name,
        sort_order = EXCLUDED.sort_order,
        active = EXCLUDED.active
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Atomic expense application import
CREATE OR REPLACE FUNCTION public.regapro_service_import_expense_application(
  p_org_id uuid,
  p_batch_id uuid,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app jsonb := p_payload -> 'application';
  v_external text := v_app ->> 'id';
  v_hash text := p_payload ->> 'contentHash';
  v_staff uuid := nullif(p_payload ->> 'staffId', '')::uuid;
  v_category uuid := nullif(p_payload ->> 'categoryId', '')::uuid;
  v_existing public.expense_applications;
  v_id uuid;
  v_status text;
  v_type text;
  v_amount integer;
  v_ver jsonb;
  v_ev jsonb;
  v_actor uuid;
  v_reviewer uuid;
  v_ev_id uuid;
BEGIN
  PERFORM public.regapro_require_service_role();
  PERFORM set_config('regapro.expense_rpc', '1', true);

  IF p_org_id IS NULL OR p_batch_id IS NULL OR v_external IS NULL OR v_hash IS NULL THEN
    RAISE EXCEPTION 'MIGRATION_INVALID_PAYLOAD: org/batch/external/hash required';
  END IF;
  IF v_staff IS NULL OR v_category IS NULL THEN
    RAISE EXCEPTION 'MIGRATION_INVALID_PAYLOAD: confirmed staffId and categoryId required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.migration_import_batches b
    WHERE b.id = p_batch_id AND b.org_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'MIGRATION_BATCH_NOT_FOUND';
  END IF;

  SELECT * INTO v_existing
  FROM public.expense_applications
  WHERE org_id = p_org_id AND migration_external_id = v_external;

  IF FOUND AND v_existing.migration_content_hash = v_hash THEN
    INSERT INTO public.migration_source_records (
      batch_id, external_record_id, external_user_id, payload, content_hash, status
    ) VALUES (
      p_batch_id, v_external, v_app ->> 'applicant_id',
      jsonb_build_object('contentHash', v_hash, 'skipped', true),
      v_hash, 'imported'
    )
    ON CONFLICT (batch_id, external_record_id) DO UPDATE
      SET content_hash = EXCLUDED.content_hash,
          status = 'imported',
          payload = EXCLUDED.payload;
    RETURN jsonb_build_object('status', 'skipped_unchanged', 'id', v_existing.id);
  END IF;

  v_status := CASE (v_app ->> 'status')
    WHEN 'pending' THEN 'pending'
    WHEN 'approved' THEN 'approved'
    WHEN 'returned' THEN 'returned'
    ELSE NULL
  END;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'MIGRATION_INVALID_STATUS: %', v_app ->> 'status';
  END IF;
  v_type := CASE (v_app ->> 'application_type')
    WHEN 'advance' THEN 'advance'
    WHEN 'after' THEN 'after'
    ELSE NULL
  END;
  IF v_type IS NULL THEN
    RAISE EXCEPTION 'MIGRATION_INVALID_TYPE: %', v_app ->> 'application_type';
  END IF;
  v_amount := public.regapro_migration_require_positive_yen('amount', (v_app ->> 'amount')::numeric);
  v_reviewer := nullif(p_payload ->> 'reviewerStaffId', '')::uuid;

  INSERT INTO public.expense_applications (
    org_id, staff_id, status, current_version_no, application_type, category_id,
    amount_yen, expense_date, description, after_reason,
    legacy_receipt_path, legacy_receipt_migrated,
    submitted_at, submitted_by_staff_id,
    returned_at, returned_by_staff_id, return_reason,
    approved_at, approved_by_staff_id,
    created_by_staff_id, created_at, updated_at,
    deleted_at, deleted_by_staff_id,
    migration_import_batch_id, migration_external_id, migration_content_hash
  ) VALUES (
    p_org_id, v_staff, v_status, greatest(coalesce((v_app ->> 'version')::int, 1), 1),
    v_type, v_category, v_amount, (v_app ->> 'expense_date')::date,
    coalesce(v_app ->> 'description', ''), v_app ->> 'after_reason',
    v_app ->> 'receipt_path', false,
    nullif(v_app ->> 'submitted_at', '')::timestamptz, v_staff,
    CASE WHEN v_status = 'returned' THEN nullif(v_app ->> 'reviewed_at', '')::timestamptz END,
    CASE WHEN v_status = 'returned' THEN v_reviewer END,
    CASE WHEN v_status = 'returned' THEN v_app ->> 'admin_note' END,
    CASE WHEN v_status = 'approved' THEN nullif(v_app ->> 'reviewed_at', '')::timestamptz END,
    CASE WHEN v_status = 'approved' THEN v_reviewer END,
    NULL,
    coalesce(nullif(v_app ->> 'created_at', '')::timestamptz, now()),
    coalesce(nullif(v_app ->> 'updated_at', '')::timestamptz, now()),
    nullif(v_app ->> 'deleted_at', '')::timestamptz,
    NULL,
    p_batch_id, v_external, v_hash
  )
  ON CONFLICT (org_id, migration_external_id) DO UPDATE SET
    staff_id = EXCLUDED.staff_id,
    status = EXCLUDED.status,
    current_version_no = EXCLUDED.current_version_no,
    application_type = EXCLUDED.application_type,
    category_id = EXCLUDED.category_id,
    amount_yen = EXCLUDED.amount_yen,
    expense_date = EXCLUDED.expense_date,
    description = EXCLUDED.description,
    after_reason = EXCLUDED.after_reason,
    legacy_receipt_path = EXCLUDED.legacy_receipt_path,
    submitted_at = EXCLUDED.submitted_at,
    submitted_by_staff_id = EXCLUDED.submitted_by_staff_id,
    returned_at = EXCLUDED.returned_at,
    returned_by_staff_id = EXCLUDED.returned_by_staff_id,
    return_reason = EXCLUDED.return_reason,
    approved_at = EXCLUDED.approved_at,
    approved_by_staff_id = EXCLUDED.approved_by_staff_id,
    created_by_staff_id = NULL,
    updated_at = EXCLUDED.updated_at,
    deleted_at = EXCLUDED.deleted_at,
    migration_import_batch_id = EXCLUDED.migration_import_batch_id,
    migration_content_hash = EXCLUDED.migration_content_hash
  RETURNING id INTO v_id;

  FOR v_ver IN SELECT * FROM jsonb_array_elements(coalesce(p_payload -> 'versions', '[]'::jsonb))
  LOOP
    INSERT INTO public.expense_application_versions (
      application_id, org_id, version_no, application_type, category_id,
      amount_yen, expense_date, description, created_by_staff_id, created_at
    ) VALUES (
      v_id, p_org_id, (v_ver ->> 'version')::int,
      CASE WHEN v_ver ->> 'application_type' = 'advance' THEN 'advance' ELSE 'after' END,
      coalesce(nullif(v_ver ->> 'categoryId', '')::uuid, v_category),
      public.regapro_migration_require_positive_yen('version.amount', (v_ver ->> 'amount')::numeric),
      (v_ver ->> 'expense_date')::date,
      coalesce(v_ver ->> 'description', ''),
      v_staff,
      coalesce(nullif(v_ver ->> 'submitted_at', '')::timestamptz, now())
    )
    ON CONFLICT (application_id, version_no) DO UPDATE SET
      application_type = EXCLUDED.application_type,
      category_id = EXCLUDED.category_id,
      amount_yen = EXCLUDED.amount_yen,
      expense_date = EXCLUDED.expense_date,
      description = EXCLUDED.description;
  END LOOP;

  FOR v_ev IN SELECT * FROM jsonb_array_elements(coalesce(p_payload -> 'events', '[]'::jsonb))
  LOOP
    v_actor := nullif(v_ev ->> 'actorStaffId', '')::uuid;
    SELECT id INTO v_ev_id
    FROM public.expense_events
    WHERE org_id = p_org_id AND migration_external_id = (v_ev ->> 'id');
    IF v_ev_id IS NULL THEN
      INSERT INTO public.expense_events (
        org_id, action, entity_type, entity_id, actor_staff_id, subject_staff_id,
        metadata, created_at, migration_external_id
      ) VALUES (
        p_org_id,
        'legacy_' || coalesce(v_ev ->> 'event_type', 'event'),
        'expense_application',
        v_id,
        v_actor,
        v_staff,
        coalesce(v_ev -> 'metadata', '{}'::jsonb) || jsonb_build_object(
          'migration_system', true,
          'legacy_event_id', v_ev ->> 'id'
        ),
        coalesce(nullif(v_ev ->> 'created_at', '')::timestamptz, now()),
        v_ev ->> 'id'
      );
    ELSE
      UPDATE public.expense_events SET
        action = 'legacy_' || coalesce(v_ev ->> 'event_type', 'event'),
        entity_id = v_id,
        actor_staff_id = v_actor,
        subject_staff_id = v_staff,
        metadata = coalesce(v_ev -> 'metadata', '{}'::jsonb) || jsonb_build_object(
          'migration_system', true,
          'legacy_event_id', v_ev ->> 'id'
        )
      WHERE id = v_ev_id;
    END IF;
  END LOOP;

  INSERT INTO public.migration_source_records (
    batch_id, external_record_id, external_user_id, payload, content_hash, status
  ) VALUES (
    p_batch_id, v_external, v_app ->> 'applicant_id',
    jsonb_build_object('contentHash', v_hash, 'status', v_status, 'migration_system', true),
    v_hash, 'imported'
  )
  ON CONFLICT (batch_id, external_record_id) DO UPDATE
    SET payload = EXCLUDED.payload,
        content_hash = EXCLUDED.content_hash,
        status = 'imported';

  RETURN jsonb_build_object(
    'status', CASE WHEN v_existing.id IS NULL THEN 'imported' ELSE 'updated' END,
    'id', v_id
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Atomic personal sales case import (all allocations must be in payload already resolved)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.regapro_service_import_personal_sales_case(
  p_org_id uuid,
  p_batch_id uuid,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sr jsonb := p_payload -> 'salesRecord';
  v_external text := v_sr ->> 'id';
  v_hash text := p_payload ->> 'contentHash';
  v_primary uuid := nullif(p_payload ->> 'primaryStaffId', '')::uuid;
  v_existing public.personal_sales_cases;
  v_id uuid;
  v_total integer;
  v_profit integer;
  v_alloc jsonb;
  v_alloc_ids text[] := ARRAY[]::text[];
  v_status text;
BEGIN
  PERFORM public.regapro_require_service_role();
  PERFORM set_config('regapro.personal_sales_rpc', '1', true);

  IF p_org_id IS NULL OR p_batch_id IS NULL OR v_external IS NULL OR v_hash IS NULL THEN
    RAISE EXCEPTION 'MIGRATION_INVALID_PAYLOAD: org/batch/external/hash required';
  END IF;
  IF jsonb_array_length(coalesce(p_payload -> 'allocations', '[]'::jsonb)) < 1 THEN
    RAISE EXCEPTION 'MIGRATION_INVALID_ALLOCATION: allocations required';
  END IF;
  IF v_primary IS NULL THEN
    RAISE EXCEPTION 'MIGRATION_INVALID_PAYLOAD: primaryStaffId required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.migration_import_batches b
    WHERE b.id = p_batch_id AND b.org_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'MIGRATION_BATCH_NOT_FOUND';
  END IF;

  SELECT * INTO v_existing
  FROM public.personal_sales_cases
  WHERE org_id = p_org_id AND migration_external_id = v_external;

  IF FOUND AND v_existing.migration_content_hash = v_hash THEN
    INSERT INTO public.migration_source_records (
      batch_id, external_record_id, payload, content_hash, status
    ) VALUES (
      p_batch_id, v_external,
      jsonb_build_object('contentHash', v_hash, 'skipped', true),
      v_hash, 'imported'
    )
    ON CONFLICT (batch_id, external_record_id) DO UPDATE
      SET content_hash = EXCLUDED.content_hash,
          status = 'imported',
          payload = EXCLUDED.payload;
    RETURN jsonb_build_object('status', 'skipped_unchanged', 'id', v_existing.id);
  END IF;

  v_total := public.regapro_migration_require_nonneg_yen(
    'invoice_amount_incl', (v_sr ->> 'invoice_amount_incl')::numeric
  );
  IF v_sr ? 'case_profit_incl' AND v_sr ->> 'case_profit_incl' IS NOT NULL THEN
    v_profit := public.regapro_migration_require_nonneg_yen(
      'case_profit_incl', (v_sr ->> 'case_profit_incl')::numeric
    );
  ELSE
    v_profit := NULL;
  END IF;

  v_status := CASE
    WHEN nullif(v_sr ->> 'deleted_at', '') IS NOT NULL THEN 'voided'
    WHEN (v_sr ->> 'is_active') = 'false' THEN 'voided'
    ELSE 'active'
  END;

  INSERT INTO public.personal_sales_cases (
    org_id, staff_id, occurred_on, title, total_amount_yen, case_profit_incl_yen,
    status, note, source_ref, created_by_staff_id, created_at, updated_at,
    migration_import_batch_id, migration_external_id, migration_content_hash
  ) VALUES (
    p_org_id, v_primary, (v_sr ->> 'work_date')::date,
    coalesce(nullif(trim(p_payload ->> 'title'), ''), 'sales ' || left(v_external, 8)),
    v_total, v_profit, v_status, NULL,
    coalesce(p_payload -> 'sourceRef', '{}'::jsonb) || jsonb_build_object('migration_system', true),
    NULL,
    coalesce(nullif(v_sr ->> 'created_at', '')::timestamptz, now()),
    coalesce(nullif(v_sr ->> 'updated_at', '')::timestamptz, now()),
    p_batch_id, v_external, v_hash
  )
  ON CONFLICT (org_id, migration_external_id) DO UPDATE SET
    staff_id = EXCLUDED.staff_id,
    occurred_on = EXCLUDED.occurred_on,
    title = EXCLUDED.title,
    total_amount_yen = EXCLUDED.total_amount_yen,
    case_profit_incl_yen = EXCLUDED.case_profit_incl_yen,
    status = EXCLUDED.status,
    source_ref = EXCLUDED.source_ref,
    created_by_staff_id = NULL,
    updated_at = EXCLUDED.updated_at,
    migration_import_batch_id = EXCLUDED.migration_import_batch_id,
    migration_content_hash = EXCLUDED.migration_content_hash
  RETURNING id INTO v_id;

  FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_payload -> 'allocations')
  LOOP
    v_alloc_ids := array_append(v_alloc_ids, v_alloc ->> 'id');
    INSERT INTO public.personal_sales_allocations (
      case_id, org_id, staff_id, allocation_type, share_rate_bps, amount_yen,
      allocated_profit_incl_yen, allocation_rule_version_id, created_at, migration_external_id
    ) VALUES (
      v_id, p_org_id, (v_alloc ->> 'staffId')::uuid, v_alloc ->> 'allocation_type',
      public.regapro_migration_require_rate_bps('allocation_rate', (v_alloc ->> 'allocation_rate')::numeric),
      public.regapro_migration_require_nonneg_yen('allocated_sales_incl', (v_alloc ->> 'allocated_sales_incl')::numeric),
      CASE WHEN v_alloc ? 'allocated_profit_incl' AND v_alloc ->> 'allocated_profit_incl' IS NOT NULL
        THEN public.regapro_migration_require_nonneg_yen(
          'allocated_profit_incl', (v_alloc ->> 'allocated_profit_incl')::numeric
        )
        ELSE NULL
      END,
      NULL,
      coalesce(nullif(v_alloc ->> 'created_at', '')::timestamptz, now()),
      v_alloc ->> 'id'
    )
    ON CONFLICT (org_id, migration_external_id) DO UPDATE SET
      case_id = EXCLUDED.case_id,
      staff_id = EXCLUDED.staff_id,
      allocation_type = EXCLUDED.allocation_type,
      share_rate_bps = EXCLUDED.share_rate_bps,
      amount_yen = EXCLUDED.amount_yen,
      allocated_profit_incl_yen = EXCLUDED.allocated_profit_incl_yen,
      allocation_rule_version_id = NULL;
  END LOOP;

  -- Remove obsolete alloc snapshots for this case only when hash changed (explicit replace).
  DELETE FROM public.personal_sales_allocations a
  WHERE a.case_id = v_id
    AND a.migration_external_id IS NOT NULL
    AND NOT (a.migration_external_id = ANY (v_alloc_ids));

  INSERT INTO public.migration_source_records (
    batch_id, external_record_id, payload, content_hash, status
  ) VALUES (
    p_batch_id, v_external,
    jsonb_build_object(
      'contentHash', v_hash,
      'allocN', jsonb_array_length(p_payload -> 'allocations'),
      'migration_system', true
    ),
    v_hash, 'imported'
  )
  ON CONFLICT (batch_id, external_record_id) DO UPDATE
    SET payload = EXCLUDED.payload,
        content_hash = EXCLUDED.content_hash,
        status = 'imported';

  RETURN jsonb_build_object(
    'status', CASE WHEN v_existing.id IS NULL THEN 'imported' ELSE 'updated' END,
    'id', v_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.regapro_service_migration_batch_finish(
  p_batch_id uuid,
  p_status text,
  p_totals jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.regapro_require_service_role();
  IF p_status NOT IN ('applied', 'failed') THEN
    RAISE EXCEPTION 'MIGRATION_INVALID_BATCH_STATUS: %', p_status;
  END IF;
  UPDATE public.migration_import_batches SET
    status = p_status,
    dry_run = false,
    applied_at = CASE WHEN p_status = 'applied' THEN now() ELSE applied_at END,
    total_records = coalesce((p_totals ->> 'total')::int, total_records),
    matched_records = coalesce((p_totals ->> 'matched')::int, matched_records),
    failed_records = coalesce((p_totals ->> 'failed')::int, failed_records),
    notes = coalesce(p_totals::text, notes)
  WHERE id = p_batch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MIGRATION_BATCH_NOT_FOUND';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.regapro_service_migration_quarantine(
  p_batch_id uuid,
  p_external_record_id text,
  p_external_user_id text,
  p_payload jsonb,
  p_content_hash text,
  p_error_code text,
  p_message text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_src uuid;
BEGIN
  PERFORM public.regapro_require_service_role();
  INSERT INTO public.migration_source_records (
    batch_id, external_record_id, external_user_id, payload, content_hash, status
  ) VALUES (
    p_batch_id, p_external_record_id, p_external_user_id, p_payload, p_content_hash, 'unmatched'
  )
  ON CONFLICT (batch_id, external_record_id) DO UPDATE
    SET payload = EXCLUDED.payload,
        content_hash = EXCLUDED.content_hash,
        status = 'unmatched',
        external_user_id = EXCLUDED.external_user_id
  RETURNING id INTO v_src;

  INSERT INTO public.migration_errors (batch_id, source_record_id, error_code, message, context)
  VALUES (
    p_batch_id, v_src, p_error_code, p_message,
    jsonb_build_object('externalPrefix', left(p_external_record_id, 8), 'migration_system', true)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.regapro_service_import_expense_category(uuid, text, text, integer, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.regapro_service_import_expense_application(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.regapro_service_import_personal_sales_case(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.regapro_service_migration_batch_finish(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.regapro_service_migration_quarantine(uuid, text, text, jsonb, text, text, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.regapro_service_import_expense_category(uuid, text, text, integer, boolean)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.regapro_service_import_expense_application(uuid, uuid, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.regapro_service_import_personal_sales_case(uuid, uuid, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.regapro_service_migration_batch_finish(uuid, text, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.regapro_service_migration_quarantine(uuid, text, text, jsonb, text, text, text)
  TO service_role;
