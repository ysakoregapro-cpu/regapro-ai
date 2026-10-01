-- Phase 8.1 follow-up: preserve legacy snapshots/notes; require description;
-- make quarantine re-runs idempotent (no error row explosion).

ALTER TABLE public.expense_applications
  ADD COLUMN IF NOT EXISTS applicant_name_snapshot text;

ALTER TABLE public.expense_applications
  ADD COLUMN IF NOT EXISTS admin_note text;

ALTER TABLE public.expense_application_versions
  ADD COLUMN IF NOT EXISTS after_reason text;

ALTER TABLE public.expense_application_versions
  ADD COLUMN IF NOT EXISTS applicant_name_snapshot text;

-- One error row per (batch, source_record, error_code) for re-run safety.
-- Deduplicate any historical duplicates before creating the unique index.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY batch_id, source_record_id, error_code
           ORDER BY created_at DESC, id DESC
         ) AS rn
  FROM public.migration_errors
  WHERE source_record_id IS NOT NULL
)
DELETE FROM public.migration_errors e
USING ranked r
WHERE e.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_migration_errors_batch_source_code
  ON public.migration_errors (batch_id, source_record_id, error_code)
  WHERE source_record_id IS NOT NULL;

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
  v_description text;
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

  -- Never invent description; missing/blank is a hard failure.
  IF NOT (v_app ? 'description') OR v_app ->> 'description' IS NULL THEN
    RAISE EXCEPTION 'MIGRATION_MISSING_DESCRIPTION';
  END IF;
  v_description := v_app ->> 'description';
  IF length(trim(v_description)) = 0 THEN
    RAISE EXCEPTION 'MIGRATION_MISSING_DESCRIPTION';
  END IF;

  v_amount := public.regapro_migration_require_positive_yen('amount', (v_app ->> 'amount')::numeric);
  v_reviewer := nullif(p_payload ->> 'reviewerStaffId', '')::uuid;

  INSERT INTO public.expense_applications (
    org_id, staff_id, status, current_version_no, application_type, category_id,
    amount_yen, expense_date, description, after_reason, admin_note,
    applicant_name_snapshot,
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
    v_description, v_app ->> 'after_reason', v_app ->> 'admin_note',
    v_app ->> 'applicant_name_snapshot',
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
    admin_note = EXCLUDED.admin_note,
    applicant_name_snapshot = EXCLUDED.applicant_name_snapshot,
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
    IF NOT (v_ver ? 'description') OR v_ver ->> 'description' IS NULL
       OR length(trim(v_ver ->> 'description')) = 0 THEN
      RAISE EXCEPTION 'MIGRATION_MISSING_DESCRIPTION: version %', v_ver ->> 'version';
    END IF;
    INSERT INTO public.expense_application_versions (
      application_id, org_id, version_no, application_type, category_id,
      amount_yen, expense_date, description, after_reason, applicant_name_snapshot,
      created_by_staff_id, created_at
    ) VALUES (
      v_id, p_org_id, (v_ver ->> 'version')::int,
      CASE WHEN v_ver ->> 'application_type' = 'advance' THEN 'advance' ELSE 'after' END,
      coalesce(nullif(v_ver ->> 'categoryId', '')::uuid, v_category),
      public.regapro_migration_require_positive_yen('version.amount', (v_ver ->> 'amount')::numeric),
      (v_ver ->> 'expense_date')::date,
      v_ver ->> 'description',
      v_ver ->> 'after_reason',
      v_ver ->> 'applicant_name_snapshot',
      v_staff,
      coalesce(nullif(v_ver ->> 'submitted_at', '')::timestamptz, now())
    )
    ON CONFLICT (application_id, version_no) DO UPDATE SET
      application_type = EXCLUDED.application_type,
      category_id = EXCLUDED.category_id,
      amount_yen = EXCLUDED.amount_yen,
      expense_date = EXCLUDED.expense_date,
      description = EXCLUDED.description,
      after_reason = EXCLUDED.after_reason,
      applicant_name_snapshot = EXCLUDED.applicant_name_snapshot;
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
  )
  ON CONFLICT (batch_id, source_record_id, error_code) WHERE source_record_id IS NOT NULL
  DO UPDATE SET
    message = EXCLUDED.message,
    context = EXCLUDED.context;
END;
$$;

REVOKE ALL ON FUNCTION public.regapro_service_import_expense_application(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.regapro_service_migration_quarantine(uuid, text, text, jsonb, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.regapro_service_import_expense_application(uuid, uuid, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.regapro_service_migration_quarantine(uuid, text, text, jsonb, text, text, text)
  TO service_role;
