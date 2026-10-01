-- Phase 8.1: approved identity ledger, staff provenance, batch current-state view,
-- reviewer name snapshots, sales no-allocation tracking.

-- ---------------------------------------------------------------------------
-- Staff provenance / affiliation (fixture vs operational; no login auto-grant)
-- ---------------------------------------------------------------------------
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS record_kind text NOT NULL DEFAULT 'operational';

ALTER TABLE public.staff
  DROP CONSTRAINT IF EXISTS staff_record_kind_check;
ALTER TABLE public.staff
  ADD CONSTRAINT staff_record_kind_check
  CHECK (record_kind IN ('operational', 'fixture', 'legacy_pending'));

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS affiliation_kind text NOT NULL DEFAULT 'unknown';

ALTER TABLE public.staff
  DROP CONSTRAINT IF EXISTS staff_affiliation_kind_check;
ALTER TABLE public.staff
  ADD CONSTRAINT staff_affiliation_kind_check
  CHECK (affiliation_kind IN (
    'employee', 'left', 'external', 'test', 'unknown'
  ));

COMMENT ON COLUMN public.staff.record_kind IS
  'operational=real roster; fixture=RLS/integration only; legacy_pending=shell for migration without login';
COMMENT ON COLUMN public.staff.affiliation_kind IS
  'People classification for migration; unknown until human confirms. Never auto-grant roles/login.';

-- Tag existing RLS fixtures by staff_no pattern (do not delete).
UPDATE public.staff
SET record_kind = 'fixture',
    affiliation_kind = 'test'
WHERE staff_no ~* '^RLSFIX'
   OR name ~* '(rls|fixture|integration)';

-- ---------------------------------------------------------------------------
-- Org-scoped approved identity map (only this drives personal publish import)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.migration_approved_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  source_system text NOT NULL,
  external_user_id text NOT NULL,
  staff_id uuid NOT NULL REFERENCES public.staff(staff_id),
  affiliation_kind text NOT NULL
    CHECK (affiliation_kind IN ('employee', 'left', 'external', 'test', 'unknown')),
  review_label text,
  evidence_notes text,
  confirmed_by_staff_id uuid REFERENCES public.staff(staff_id),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, source_system, external_user_id)
);

CREATE INDEX IF NOT EXISTS idx_migration_approved_identities_staff
  ON public.migration_approved_identities (staff_id);

COMMENT ON TABLE public.migration_approved_identities IS
  'Human-approved legacy person -> staff mapping. Email match alone never writes here.';

ALTER TABLE public.migration_approved_identities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS migration_approved_identities_manage ON public.migration_approved_identities;
CREATE POLICY migration_approved_identities_manage ON public.migration_approved_identities
  FOR ALL USING (public.regapro_can_manage_staff(org_id))
  WITH CHECK (public.regapro_can_manage_staff(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.migration_approved_identities TO authenticated;
GRANT ALL ON TABLE public.migration_approved_identities TO service_role;

-- Forbid approved map pointing at fixture staff.
CREATE OR REPLACE FUNCTION public.regapro_migration_approved_identity_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_kind text;
  v_org uuid;
BEGIN
  SELECT record_kind, org_id INTO v_kind, v_org
  FROM public.staff WHERE staff_id = NEW.staff_id;
  IF v_org IS NULL OR v_org <> NEW.org_id THEN
    RAISE EXCEPTION 'MIGRATION_IDENTITY_ORG_MISMATCH';
  END IF;
  IF v_kind = 'fixture' THEN
    RAISE EXCEPTION 'MIGRATION_IDENTITY_FIXTURE_FORBIDDEN: do not bind legacy people to fixture staff';
  END IF;
  IF NEW.affiliation_kind = 'unknown' THEN
    RAISE EXCEPTION 'MIGRATION_IDENTITY_AFFILIATION_REQUIRED';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_migration_approved_identity_guard ON public.migration_approved_identities;
CREATE TRIGGER trg_migration_approved_identity_guard
  BEFORE INSERT OR UPDATE ON public.migration_approved_identities
  FOR EACH ROW EXECUTE FUNCTION public.regapro_migration_approved_identity_guard();

REVOKE ALL ON FUNCTION public.regapro_migration_approved_identity_guard() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Batch purpose + current ledger view (13 expense / 191 sales unique sources)
-- ---------------------------------------------------------------------------
ALTER TABLE public.migration_import_batches
  ADD COLUMN IF NOT EXISTS batch_purpose text NOT NULL DEFAULT 'import';

ALTER TABLE public.migration_import_batches
  DROP CONSTRAINT IF EXISTS migration_import_batches_batch_purpose_check;
ALTER TABLE public.migration_import_batches
  ADD CONSTRAINT migration_import_batches_batch_purpose_check
  CHECK (batch_purpose IN ('import', 'verification', 'fail_inject'));

COMMENT ON COLUMN public.migration_import_batches.batch_purpose IS
  'import=production migration run; verification/fail_inject=test harness — do not treat as canonical alone';

CREATE OR REPLACE VIEW public.migration_source_record_current
WITH (security_invoker = true)
AS
SELECT DISTINCT ON (b.org_id, b.source_system, b.entity_kind, r.external_record_id)
  b.org_id,
  b.source_system,
  b.entity_kind,
  r.external_record_id,
  r.external_user_id,
  r.content_hash,
  r.status AS record_status,
  r.payload,
  b.id AS batch_id,
  b.status AS batch_status,
  b.batch_purpose,
  b.dry_run,
  b.created_at AS batch_created_at,
  r.created_at AS record_created_at
FROM public.migration_source_records r
JOIN public.migration_import_batches b ON b.id = r.batch_id
ORDER BY b.org_id, b.source_system, b.entity_kind, r.external_record_id,
         b.created_at DESC, r.created_at DESC;

COMMENT ON VIEW public.migration_source_record_current IS
  'Latest migration_source_records row per legacy external_record_id (org/system/entity).';

GRANT SELECT ON public.migration_source_record_current TO authenticated;
GRANT SELECT ON public.migration_source_record_current TO service_role;

-- Mark historical fail-inject / verification batches by label pattern (non-destructive).
UPDATE public.migration_import_batches
SET batch_purpose = 'fail_inject'
WHERE label ILIKE '%fail%' OR notes ILIKE '%INJECTED_FAILURE%';

UPDATE public.migration_import_batches
SET batch_purpose = 'verification'
WHERE dry_run = true
   OR (label ILIKE '%phase81%' AND matched_records = 0 AND failed_records = 0 AND total_records > 0
       AND status = 'applied' AND batch_purpose = 'import'
       AND EXISTS (
         SELECT 1 FROM public.migration_source_records r
         WHERE r.batch_id = migration_import_batches.id AND r.status = 'unmatched'
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.migration_source_records r
         WHERE r.batch_id = migration_import_batches.id AND r.status = 'imported'
       ));

-- ---------------------------------------------------------------------------
-- Expense: keep reviewer identity as history even without staff mapping
-- ---------------------------------------------------------------------------
ALTER TABLE public.expense_applications
  ADD COLUMN IF NOT EXISTS reviewed_by_legacy_id text;

ALTER TABLE public.expense_applications
  ADD COLUMN IF NOT EXISTS reviewed_by_name_snapshot text;

ALTER TABLE public.expense_events
  ADD COLUMN IF NOT EXISTS actor_legacy_id text;

ALTER TABLE public.expense_events
  ADD COLUMN IF NOT EXISTS actor_name_snapshot text;

-- ---------------------------------------------------------------------------
-- Personal sales: distinguish admin-trackable no-allocation legacy rows
-- ---------------------------------------------------------------------------
ALTER TABLE public.personal_sales_cases
  ADD COLUMN IF NOT EXISTS migration_hold_reason text;

ALTER TABLE public.personal_sales_cases
  DROP CONSTRAINT IF EXISTS personal_sales_cases_migration_hold_reason_check;
ALTER TABLE public.personal_sales_cases
  ADD CONSTRAINT personal_sales_cases_migration_hold_reason_check
  CHECK (
    migration_hold_reason IS NULL
    OR migration_hold_reason IN (
      'no_allocations',
      'identity_incomplete',
      'amount_invalid',
      'partial_allocation'
    )
  );

-- ---------------------------------------------------------------------------
-- Service helpers for approved identity + ledger summary
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.regapro_service_list_migration_ledger(
  p_org_id uuid,
  p_source_system text DEFAULT NULL,
  p_entity_kind text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batches jsonb;
  v_current jsonb;
BEGIN
  PERFORM public.regapro_require_service_role();
  SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.created_at DESC), '[]'::jsonb)
  INTO v_batches
  FROM (
    SELECT id, source_system, entity_kind, label, status, dry_run, batch_purpose,
           total_records, matched_records, failed_records, created_at, applied_at
    FROM public.migration_import_batches
    WHERE org_id = p_org_id
      AND (p_source_system IS NULL OR source_system = p_source_system)
      AND (p_entity_kind IS NULL OR entity_kind = p_entity_kind)
    ORDER BY created_at DESC
    LIMIT 50
  ) b;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'source_system', c.source_system,
    'entity_kind', c.entity_kind,
    'external_record_id_prefix', left(c.external_record_id, 8),
    'record_status', c.record_status,
    'batch_purpose', c.batch_purpose,
    'batch_status', c.batch_status,
    'batch_id', c.batch_id
  ) ORDER BY c.source_system, c.entity_kind, c.external_record_id), '[]'::jsonb)
  INTO v_current
  FROM public.migration_source_record_current c
  WHERE c.org_id = p_org_id
    AND (p_source_system IS NULL OR c.source_system = p_source_system)
    AND (p_entity_kind IS NULL OR c.entity_kind = p_entity_kind);

  RETURN jsonb_build_object(
    'batches', v_batches,
    'current_unique_n', jsonb_array_length(v_current),
    'current_sample', v_current
  );
END;
$$;

REVOKE ALL ON FUNCTION public.regapro_service_list_migration_ledger(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.regapro_service_list_migration_ledger(uuid, text, text)
  TO service_role;

-- Patch expense import RPC: persist reviewer/actor legacy snapshots without inventing staff.
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
  IF NOT (v_app ? 'description') OR v_app ->> 'description' IS NULL
     OR length(trim(v_app ->> 'description')) = 0 THEN
    RAISE EXCEPTION 'MIGRATION_MISSING_DESCRIPTION';
  END IF;
  v_description := v_app ->> 'description';
  v_amount := public.regapro_migration_require_positive_yen('amount', (v_app ->> 'amount')::numeric);
  v_reviewer := nullif(p_payload ->> 'reviewerStaffId', '')::uuid;

  INSERT INTO public.expense_applications (
    org_id, staff_id, status, current_version_no, application_type, category_id,
    amount_yen, expense_date, description, after_reason, admin_note,
    applicant_name_snapshot,
    reviewed_by_legacy_id, reviewed_by_name_snapshot,
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
    nullif(v_app ->> 'reviewed_by', ''),
    nullif(p_payload ->> 'reviewerNameSnapshot', ''),
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
    reviewed_by_legacy_id = EXCLUDED.reviewed_by_legacy_id,
    reviewed_by_name_snapshot = EXCLUDED.reviewed_by_name_snapshot,
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
        metadata, created_at, migration_external_id,
        actor_legacy_id, actor_name_snapshot
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
        v_ev ->> 'id',
        nullif(v_ev ->> 'actor_id', ''),
        nullif(v_ev ->> 'actorNameSnapshot', '')
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
        ),
        actor_legacy_id = nullif(v_ev ->> 'actor_id', ''),
        actor_name_snapshot = nullif(v_ev ->> 'actorNameSnapshot', '')
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

REVOKE ALL ON FUNCTION public.regapro_service_import_expense_application(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.regapro_service_import_expense_application(uuid, uuid, jsonb)
  TO service_role;
