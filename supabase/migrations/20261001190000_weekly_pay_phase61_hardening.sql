-- Phase 6.1: encrypt transferor account numbers, seal batch ciphertext off SELECT,
-- harden bank business-day calendar, enforce payment state machine / resend locks.
-- Forward-only. Existing row counts at authoring time: transferor=0, batches=0.

-- ---------------------------------------------------------------------------
-- 1) Transferor: encrypt source account number
-- ---------------------------------------------------------------------------
ALTER TABLE public.weekly_pay_transferor_settings
  ADD COLUMN IF NOT EXISTS source_account_number_ciphertext bytea,
  ADD COLUMN IF NOT EXISTS source_account_number_last4 text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'weekly_pay_transferor_settings'
      AND column_name = 'source_account_number'
  ) THEN
    PERFORM set_config('regapro.weekly_pay_rpc', '1', true);
    UPDATE public.weekly_pay_transferor_settings
      SET source_account_number_ciphertext =
            public.regapro_encrypt_bank_account_number(source_account_number),
          source_account_number_last4 = right(source_account_number, 4)
    WHERE source_account_number_ciphertext IS NULL
      AND source_account_number IS NOT NULL;
    ALTER TABLE public.weekly_pay_transferor_settings
      DROP CONSTRAINT IF EXISTS weekly_pay_transferor_account_chk;
    ALTER TABLE public.weekly_pay_transferor_settings
      DROP COLUMN source_account_number;
  END IF;
END $$;

ALTER TABLE public.weekly_pay_transferor_settings
  ALTER COLUMN source_account_number_ciphertext SET NOT NULL,
  ALTER COLUMN source_account_number_last4 SET NOT NULL;

ALTER TABLE public.weekly_pay_transferor_settings
  DROP CONSTRAINT IF EXISTS weekly_pay_transferor_last4_chk;
ALTER TABLE public.weekly_pay_transferor_settings
  ADD CONSTRAINT weekly_pay_transferor_last4_chk
  CHECK (source_account_number_last4 ~ '^\d{4}$');

REVOKE ALL ON TABLE public.weekly_pay_transferor_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  org_id, consignor_code, requester_name_kana, source_bank_code, source_bank_name_kana,
  source_branch_code, source_branch_name_kana, source_account_type,
  source_account_number_last4, updated_by_staff_id, created_at, updated_at
) ON public.weekly_pay_transferor_settings TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) Batches: sealed transferor ciphertext column; sanitize snapshot JSON
-- ---------------------------------------------------------------------------
ALTER TABLE public.weekly_pay_payment_batches
  ADD COLUMN IF NOT EXISTS transferor_account_number_ciphertext bytea;

DO $$
BEGIN
  PERFORM set_config('regapro.weekly_pay_rpc', '1', true);
  -- Re-seal from transferor settings when plaintext leaked into snapshot (safe if 0 rows).
  UPDATE public.weekly_pay_payment_batches b
     SET transferor_account_number_ciphertext = COALESCE(
           b.transferor_account_number_ciphertext,
           t.source_account_number_ciphertext,
           CASE
             WHEN b.transferor_snapshot ? 'sourceAccountNumber'
               AND (b.transferor_snapshot->>'sourceAccountNumber') ~ '^\d{7}$'
             THEN public.regapro_encrypt_bank_account_number(
                    b.transferor_snapshot->>'sourceAccountNumber'
                  )
             ELSE NULL
           END
         ),
         transferor_snapshot = (
           COALESCE(b.transferor_snapshot, '{}'::jsonb)
             - 'sourceAccountNumber'
             - 'sourceAccountNumberCiphertext'
         ) || jsonb_build_object(
           'sourceAccountNumberLast4',
           COALESCE(
             b.transferor_snapshot->>'sourceAccountNumberLast4',
             t.source_account_number_last4,
             CASE
               WHEN b.transferor_snapshot ? 'sourceAccountNumber'
               THEN right(b.transferor_snapshot->>'sourceAccountNumber', 4)
               ELSE NULL
             END
           )
         )
    FROM public.weekly_pay_transferor_settings t
   WHERE t.org_id = b.org_id
     AND (
       b.transferor_account_number_ciphertext IS NULL
       OR b.transferor_snapshot ? 'sourceAccountNumber'
       OR b.transferor_snapshot ? 'sourceAccountNumberCiphertext'
     );
END $$;

-- Empty table or fully backfilled → enforce NOT NULL
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.weekly_pay_payment_batches
    WHERE transferor_account_number_ciphertext IS NULL
  ) THEN
    ALTER TABLE public.weekly_pay_payment_batches
      ALTER COLUMN transferor_account_number_ciphertext SET NOT NULL;
  END IF;
END $$;

REVOKE ALL ON TABLE public.weekly_pay_payment_batches FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id, org_id, status, bank_transfer_date, scheduled_payment_date, format_code,
  item_count, total_amount_yen, content_fingerprint, transferor_snapshot,
  supersedes_batch_id, superseded_by_batch_id, created_by_staff_id,
  created_at, updated_at, cancelled_at, cancelled_by_staff_id, cancel_reason,
  exported_at, export_count, bank_submitted_at, bank_submission_note,
  bank_file_ref, closed_at
) ON public.weekly_pay_payment_batches TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) Bank business day: year coverage fail-closed + year-end closure
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.japanese_bank_holiday_coverage (
  calendar_year integer PRIMARY KEY,
  verified boolean NOT NULL DEFAULT true,
  note text
);

INSERT INTO public.japanese_bank_holiday_coverage (calendar_year, verified, note) VALUES
  (2025, true, 'seeded national holidays 2025'),
  (2026, true, 'seeded national holidays 2026'),
  (2027, true, 'seeded national holidays 2027')
ON CONFLICT (calendar_year) DO NOTHING;

ALTER TABLE public.japanese_bank_holiday_coverage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS japanese_bank_holiday_coverage_select ON public.japanese_bank_holiday_coverage;
CREATE POLICY japanese_bank_holiday_coverage_select ON public.japanese_bank_holiday_coverage
  FOR SELECT TO authenticated, service_role
  USING (true);
REVOKE ALL ON public.japanese_bank_holiday_coverage FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.japanese_bank_holiday_coverage TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.regapro_is_japanese_bank_business_day(p_date date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p_date IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.japanese_bank_holiday_coverage c
      WHERE c.calendar_year = EXTRACT(YEAR FROM p_date)::integer
        AND c.verified
    )
    AND EXTRACT(ISODOW FROM p_date) BETWEEN 1 AND 5
    -- Docomo SMTB: Dec 31 - Jan 3 are bank holidays every year.
    AND NOT (
      (EXTRACT(MONTH FROM p_date)::integer = 12 AND EXTRACT(DAY FROM p_date)::integer = 31)
      OR (EXTRACT(MONTH FROM p_date)::integer = 1 AND EXTRACT(DAY FROM p_date)::integer BETWEEN 1 AND 3)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.japanese_bank_holidays h WHERE h.holiday_date = p_date
    );
$$;

-- ---------------------------------------------------------------------------
-- Masked batch JSON (never includes transferor ciphertext / plaintext)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.regapro_mask_weekly_pay_payment_batch(
  p_batch public.weekly_pay_payment_batches
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', p_batch.id,
    'org_id', p_batch.org_id,
    'status', p_batch.status,
    'bank_transfer_date', p_batch.bank_transfer_date,
    'scheduled_payment_date', p_batch.scheduled_payment_date,
    'format_code', p_batch.format_code,
    'item_count', p_batch.item_count,
    'total_amount_yen', p_batch.total_amount_yen,
    'content_fingerprint', p_batch.content_fingerprint,
    'transferor_snapshot',
      (COALESCE(p_batch.transferor_snapshot, '{}'::jsonb)
        - 'sourceAccountNumber'
        - 'sourceAccountNumberCiphertext'),
    'export_count', p_batch.export_count,
    'exported_at', p_batch.exported_at,
    'bank_submitted_at', p_batch.bank_submitted_at,
    'bank_submission_note', p_batch.bank_submission_note,
    'bank_file_ref', p_batch.bank_file_ref,
    'created_by_staff_id', p_batch.created_by_staff_id,
    'created_at', p_batch.created_at,
    'updated_at', p_batch.updated_at,
    'cancelled_at', p_batch.cancelled_at,
    'cancel_reason', p_batch.cancel_reason,
    'closed_at', p_batch.closed_at
  );
$$;

REVOKE ALL ON FUNCTION public.regapro_mask_weekly_pay_payment_batch(public.weekly_pay_payment_batches)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.regapro_mask_weekly_pay_batch_item(
  p_item public.weekly_pay_payment_batch_items
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', p_item.id,
    'batch_id', p_item.batch_id,
    'org_id', p_item.org_id,
    'application_id', p_item.application_id,
    'staff_id', p_item.staff_id,
    'amount_yen', p_item.amount_yen,
    'week_start', p_item.week_start,
    'week_end', p_item.week_end,
    'application_payment_date', p_item.application_payment_date,
    'work_record_ids', p_item.work_record_ids,
    'bank_snapshot', p_item.bank_snapshot,
    'outcome', p_item.outcome,
    'paid_on', p_item.paid_on,
    'bank_transaction_ref', p_item.bank_transaction_ref,
    'evidence_note', p_item.evidence_note,
    'failure_reason', p_item.failure_reason,
    'settled_at', p_item.settled_at,
    'created_at', p_item.created_at
  );
$$;

REVOKE ALL ON FUNCTION public.regapro_mask_weekly_pay_batch_item(public.weekly_pay_payment_batch_items)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Transferor get/upsert (ciphertext)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_weekly_pay_transferor_settings_masked()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_org uuid;
  v_row public.weekly_pay_transferor_settings;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  SELECT s.org_id INTO v_org FROM public.staff s
  WHERE s.staff_id = v_actor AND s.status = 'active';
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    public.regapro_staff_has_permission(v_org, 'weekly_pay.pay')
    OR public.regapro_staff_has_permission(v_org, 'weekly_pay.manage')
  ) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: weekly_pay.pay required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.weekly_pay_transferor_settings WHERE org_id = v_org;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'org_id', v_row.org_id,
    'consignor_code', v_row.consignor_code,
    'requester_name_kana', v_row.requester_name_kana,
    'source_bank_code', v_row.source_bank_code,
    'source_bank_name_kana', v_row.source_bank_name_kana,
    'source_branch_code', v_row.source_branch_code,
    'source_branch_name_kana', v_row.source_branch_name_kana,
    'source_account_type', v_row.source_account_type,
    'source_account_number_last4', v_row.source_account_number_last4,
    'updated_at', v_row.updated_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_weekly_pay_transferor_settings(
  p_consignor_code text,
  p_requester_name_kana text,
  p_source_bank_code text,
  p_source_bank_name_kana text,
  p_source_branch_code text,
  p_source_branch_name_kana text,
  p_source_account_type text,
  p_source_account_number text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_org uuid;
  v_row public.weekly_pay_transferor_settings;
  v_name text := btrim(p_requester_name_kana);
  v_cipher bytea;
  v_last4 text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  SELECT s.org_id INTO v_org FROM public.staff s
  WHERE s.staff_id = v_actor AND s.status = 'active';
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    public.regapro_staff_has_permission(v_org, 'weekly_pay.pay')
    OR public.regapro_staff_has_permission(v_org, 'weekly_pay.manage')
  ) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: weekly_pay.pay required' USING ERRCODE = '42501';
  END IF;

  IF p_consignor_code IS NULL OR p_consignor_code !~ '^20\d{8}$' THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_TRANSFEROR: consignor_code must be 20 + 8 digits';
  END IF;
  IF v_name IS NULL OR char_length(v_name) = 0 OR char_length(v_name) > 40 THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_TRANSFEROR: requester_name_kana invalid';
  END IF;
  IF p_source_bank_code IS NULL OR p_source_bank_code !~ '^\d{4}$' THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_TRANSFEROR: source_bank_code must be 4 digits';
  END IF;
  IF p_source_branch_code IS NULL OR p_source_branch_code !~ '^\d{3}$' THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_TRANSFEROR: source_branch_code must be 3 digits';
  END IF;
  IF p_source_account_type IS NULL OR p_source_account_type NOT IN ('ordinary', 'current') THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_TRANSFEROR: source_account_type invalid';
  END IF;
  IF p_source_account_number IS NULL OR p_source_account_number !~ '^\d{7}$' THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_TRANSFEROR: source_account_number must be 7 digits';
  END IF;

  v_cipher := public.regapro_encrypt_bank_account_number(p_source_account_number);
  v_last4 := right(p_source_account_number, 4);

  PERFORM set_config('regapro.weekly_pay_rpc', '1', true);

  INSERT INTO public.weekly_pay_transferor_settings (
    org_id, consignor_code, requester_name_kana, source_bank_code, source_bank_name_kana,
    source_branch_code, source_branch_name_kana, source_account_type,
    source_account_number_ciphertext, source_account_number_last4, updated_by_staff_id
  ) VALUES (
    v_org, p_consignor_code, v_name, p_source_bank_code, NULLIF(btrim(p_source_bank_name_kana), ''),
    p_source_branch_code, NULLIF(btrim(p_source_branch_name_kana), ''),
    p_source_account_type, v_cipher, v_last4, v_actor
  )
  ON CONFLICT (org_id) DO UPDATE SET
    consignor_code = EXCLUDED.consignor_code,
    requester_name_kana = EXCLUDED.requester_name_kana,
    source_bank_code = EXCLUDED.source_bank_code,
    source_bank_name_kana = EXCLUDED.source_bank_name_kana,
    source_branch_code = EXCLUDED.source_branch_code,
    source_branch_name_kana = EXCLUDED.source_branch_name_kana,
    source_account_type = EXCLUDED.source_account_type,
    source_account_number_ciphertext = EXCLUDED.source_account_number_ciphertext,
    source_account_number_last4 = EXCLUDED.source_account_number_last4,
    updated_by_staff_id = EXCLUDED.updated_by_staff_id,
    updated_at = now()
  RETURNING * INTO v_row;

  PERFORM public.regapro_write_weekly_pay_audit(
    v_org, 'transferor_settings_upserted', 'transferor_settings', v_org,
    v_actor, NULL,
    jsonb_build_object(
      'consignor_code_prefix', left(p_consignor_code, 2),
      'source_bank_code', p_source_bank_code,
      'source_branch_code', p_source_branch_code,
      'source_account_last4', v_last4
    )
  );
  RETURN jsonb_build_object(
    'org_id', v_row.org_id,
    'consignor_code', v_row.consignor_code,
    'requester_name_kana', v_row.requester_name_kana,
    'source_bank_code', v_row.source_bank_code,
    'source_bank_name_kana', v_row.source_bank_name_kana,
    'source_branch_code', v_row.source_branch_code,
    'source_branch_name_kana', v_row.source_branch_name_kana,
    'source_account_type', v_row.source_account_type,
    'source_account_number_last4', v_row.source_account_number_last4,
    'updated_at', v_row.updated_at
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Create batch → returns masked jsonb; seals transferor ciphertext off snapshot
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Create batch → returns masked jsonb; seals transferor ciphertext off snapshot
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_weekly_pay_payment_batch(uuid[], date, date);
CREATE OR REPLACE FUNCTION public.create_weekly_pay_payment_batch(
  p_application_ids uuid[],
  p_bank_transfer_date date,
  p_scheduled_payment_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_org uuid;
  v_ids uuid[];
  v_xfer public.weekly_pay_transferor_settings;
  v_batch public.weekly_pay_payment_batches;
  v_count integer;
  v_total bigint;
  v_fp text;
  v_snap jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  SELECT s.org_id INTO v_org FROM public.staff s
  WHERE s.staff_id = v_actor AND s.status = 'active';
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    public.regapro_staff_has_permission(v_org, 'weekly_pay.pay')
    OR public.regapro_staff_has_permission(v_org, 'weekly_pay.manage')
  ) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: weekly_pay.pay required' USING ERRCODE = '42501';
  END IF;
  IF p_application_ids IS NULL OR cardinality(p_application_ids) = 0 THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_SELECTION: no applications selected';
  END IF;
  IF p_bank_transfer_date IS NULL THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_TRANSFER_DATE: bank_transfer_date required';
  END IF;
  IF NOT public.regapro_is_japanese_bank_business_day(p_bank_transfer_date) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_TRANSFER_DATE: bank_transfer_date is not a bank business day';
  END IF;

  SELECT array_agg(DISTINCT x) INTO v_ids FROM unnest(p_application_ids) AS x;

  SELECT * INTO v_xfer FROM public.weekly_pay_transferor_settings WHERE org_id = v_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WEEKLY_PAY_TRANSFEROR_UNSET: configure transferor settings before export';
  END IF;

  PERFORM set_config('regapro.weekly_pay_rpc', '1', true);
  PERFORM pg_advisory_xact_lock(hashtext('weekly_pay_payment_batch:' || v_org::text));

  PERFORM 1 FROM public.weekly_applications a
  WHERE a.id = ANY (v_ids) AND a.org_id = v_org
  FOR UPDATE;

  IF (
    SELECT count(*) FROM public.weekly_applications a
    WHERE a.id = ANY (v_ids) AND a.org_id = v_org AND a.status = 'approved'
  ) <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_SELECTION: only approved applications in-org are allowed'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.weekly_pay_payment_batch_items i
    WHERE i.application_id = ANY (v_ids)
      AND i.outcome IN ('pending', 'unknown', 'paid')
  ) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_DUPLICATE_BATCH: application already in an active payment batch'
      USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.weekly_pay_settlement_ledger l
    WHERE l.application_id = ANY (v_ids) AND l.voided_at IS NULL
  ) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_ALREADY_PAID: application already settled'
      USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.weekly_applications a
    LEFT JOIN public.application_bank_snapshots s ON s.application_id = a.id
    WHERE a.id = ANY (v_ids) AND s.application_id IS NULL
  ) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_NO_BANK: bank snapshot missing for application';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.application_bank_snapshots s
    WHERE s.application_id = ANY (v_ids)
      AND char_length(public.regapro_decrypt_bank_account_number_cipher(s.account_number_ciphertext)) > 7
  ) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_BANK: destination account_number exceeds 7 digits for SMTB CSV';
  END IF;

  v_snap := jsonb_build_object(
    'consignorCode', v_xfer.consignor_code,
    'requesterNameKana', v_xfer.requester_name_kana,
    'sourceBankCode', v_xfer.source_bank_code,
    'sourceBankNameKana', v_xfer.source_bank_name_kana,
    'sourceBranchCode', v_xfer.source_branch_code,
    'sourceBranchNameKana', v_xfer.source_branch_name_kana,
    'sourceAccountType', v_xfer.source_account_type,
    'sourceAccountNumberLast4', v_xfer.source_account_number_last4
  );

  SELECT count(*)::integer, COALESCE(sum(a.total_amount_yen), 0)::bigint
  INTO v_count, v_total
  FROM public.weekly_applications a
  WHERE a.id = ANY (v_ids);

  v_fp := encode(
    sha256(
      convert_to(
        v_org::text || '|' || p_bank_transfer_date::text || '|' ||
        (SELECT string_agg(x::text, ',' ORDER BY x) FROM unnest(v_ids) x) || '|' ||
        v_total::text || '|' || v_count::text || '|' || v_xfer.consignor_code || '|' ||
        v_xfer.source_account_number_last4,
        'UTF8'
      )
    ),
    'hex'
  );

  INSERT INTO public.weekly_pay_payment_batches (
    org_id, status, bank_transfer_date, scheduled_payment_date, item_count, total_amount_yen,
    content_fingerprint, transferor_snapshot, transferor_account_number_ciphertext,
    created_by_staff_id
  ) VALUES (
    v_org, 'confirmed', p_bank_transfer_date, p_scheduled_payment_date, v_count, v_total,
    v_fp, v_snap, v_xfer.source_account_number_ciphertext, v_actor
  )
  RETURNING * INTO v_batch;

  INSERT INTO public.weekly_pay_payment_batch_items (
    batch_id, org_id, application_id, staff_id, amount_yen, week_start, week_end,
    application_payment_date, work_record_ids, policy_snapshot, bank_snapshot,
    account_number_ciphertext, outcome
  )
  SELECT
    v_batch.id,
    a.org_id,
    a.id,
    a.staff_id,
    a.total_amount_yen,
    a.week_start,
    a.week_end,
    a.payment_date,
    COALESCE((
      SELECT array_agg(i.work_record_id ORDER BY i.work_date, i.work_record_id)
      FROM public.weekly_application_items i
      WHERE i.application_id = a.id
    ), ARRAY[]::uuid[]),
    a.policy_snapshot,
    jsonb_build_object(
      'bankName', s.bank_name,
      'bankCode', s.bank_code,
      'branchName', s.branch_name,
      'branchCode', s.branch_code,
      'accountType', s.account_type,
      'accountNumberLast4', s.account_number_last4,
      'accountHolderKana', s.account_holder_kana,
      'sourceBankAccountId', s.source_bank_account_id
    ),
    s.account_number_ciphertext,
    'pending'
  FROM public.weekly_applications a
  JOIN public.application_bank_snapshots s ON s.application_id = a.id
  WHERE a.id = ANY (v_ids)
  ORDER BY a.staff_id, a.id;

  PERFORM public.regapro_write_weekly_pay_audit(
    v_org, 'payment_batch_created', 'payment_batch', v_batch.id,
    v_actor, NULL,
    jsonb_build_object(
      'item_count', v_count,
      'total_amount_yen', v_total,
      'bank_transfer_date', p_bank_transfer_date,
      'scheduled_payment_date', p_scheduled_payment_date,
      'content_fingerprint', v_fp
    )
  );
  RETURN public.regapro_mask_weekly_pay_payment_batch(v_batch);
END;
$$;

DROP FUNCTION IF EXISTS public.cancel_weekly_pay_payment_batch(uuid, text);
CREATE OR REPLACE FUNCTION public.cancel_weekly_pay_payment_batch(
  p_batch_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_batch public.weekly_pay_payment_batches;
  v_reason text := btrim(p_reason);
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) < 1 THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_REASON: cancel reason required';
  END IF;

  PERFORM set_config('regapro.weekly_pay_rpc', '1', true);
  SELECT * INTO v_batch FROM public.weekly_pay_payment_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WEEKLY_PAY_NOT_FOUND: payment batch';
  END IF;
  IF NOT public.regapro_staff_belongs_to_org(v_batch.org_id) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: cross-org denied' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    public.regapro_staff_has_permission(v_batch.org_id, 'weekly_pay.pay')
    OR public.regapro_staff_has_permission(v_batch.org_id, 'weekly_pay.manage')
  ) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: weekly_pay.pay required' USING ERRCODE = '42501';
  END IF;
  IF v_batch.status NOT IN ('confirmed', 'exported') THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_TRANSITION: bulk cancel only before bank submission (status=%)', v_batch.status;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.weekly_pay_payment_batch_items i
    WHERE i.batch_id = v_batch.id AND i.outcome IN ('paid', 'unknown')
  ) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_TRANSITION: cannot bulk-cancel paid or unknown items';
  END IF;

  UPDATE public.weekly_pay_payment_batch_items
    SET outcome = 'cancelled', settled_at = now()
  WHERE batch_id = v_batch.id AND outcome IN ('pending', 'failed');

  UPDATE public.weekly_pay_payment_batches
    SET status = 'cancelled',
        cancelled_at = now(),
        cancelled_by_staff_id = v_actor,
        cancel_reason = v_reason,
        updated_at = now()
  WHERE id = v_batch.id
  RETURNING * INTO v_batch;

  PERFORM public.regapro_write_weekly_pay_audit(
    v_batch.org_id, 'payment_batch_cancelled', 'payment_batch', v_batch.id,
    v_actor, NULL, jsonb_build_object('reason', v_reason)
  );
  RETURN public.regapro_mask_weekly_pay_payment_batch(v_batch);
END;
$$;

DROP FUNCTION IF EXISTS public.record_weekly_pay_batch_export(uuid);
CREATE OR REPLACE FUNCTION public.record_weekly_pay_batch_export(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_batch public.weekly_pay_payment_batches;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('regapro.weekly_pay_rpc', '1', true);
  SELECT * INTO v_batch FROM public.weekly_pay_payment_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WEEKLY_PAY_NOT_FOUND: payment batch';
  END IF;
  IF NOT public.regapro_staff_belongs_to_org(v_batch.org_id) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: cross-org denied' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    public.regapro_staff_has_permission(v_batch.org_id, 'weekly_pay.pay')
    OR public.regapro_staff_has_permission(v_batch.org_id, 'weekly_pay.manage')
  ) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: weekly_pay.pay required' USING ERRCODE = '42501';
  END IF;
  IF v_batch.status NOT IN ('confirmed', 'exported') THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_TRANSITION: cannot export from %', v_batch.status;
  END IF;

  UPDATE public.weekly_pay_payment_batches
    SET status = CASE WHEN status = 'confirmed' THEN 'exported' ELSE status END,
        exported_at = COALESCE(exported_at, now()),
        export_count = export_count + 1,
        updated_at = now()
  WHERE id = v_batch.id
  RETURNING * INTO v_batch;

  PERFORM public.regapro_write_weekly_pay_audit(
    v_batch.org_id, 'payment_batch_csv_exported', 'payment_batch', v_batch.id,
    v_actor, NULL,
    jsonb_build_object(
      'export_count', v_batch.export_count,
      'content_fingerprint', v_batch.content_fingerprint,
      'item_count', v_batch.item_count,
      'total_amount_yen', v_batch.total_amount_yen
    )
  );
  RETURN public.regapro_mask_weekly_pay_payment_batch(v_batch);
END;
$$;

DROP FUNCTION IF EXISTS public.record_weekly_pay_batch_bank_submission(uuid, text, text);
CREATE OR REPLACE FUNCTION public.record_weekly_pay_batch_bank_submission(
  p_batch_id uuid,
  p_note text DEFAULT NULL,
  p_bank_file_ref text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_batch public.weekly_pay_payment_batches;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('regapro.weekly_pay_rpc', '1', true);
  SELECT * INTO v_batch FROM public.weekly_pay_payment_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WEEKLY_PAY_NOT_FOUND: payment batch';
  END IF;
  IF NOT public.regapro_staff_belongs_to_org(v_batch.org_id) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: cross-org denied' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    public.regapro_staff_has_permission(v_batch.org_id, 'weekly_pay.pay')
    OR public.regapro_staff_has_permission(v_batch.org_id, 'weekly_pay.manage')
  ) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: weekly_pay.pay required' USING ERRCODE = '42501';
  END IF;
  IF v_batch.status NOT IN ('exported', 'bank_submitted') THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_TRANSITION: bank submission requires exported batch (status=%)', v_batch.status;
  END IF;

  UPDATE public.weekly_pay_payment_batches
    SET status = 'bank_submitted',
        bank_submitted_at = COALESCE(bank_submitted_at, now()),
        bank_submission_note = NULLIF(btrim(p_note), ''),
        bank_file_ref = NULLIF(btrim(p_bank_file_ref), ''),
        updated_at = now()
  WHERE id = v_batch.id
  RETURNING * INTO v_batch;

  PERFORM public.regapro_write_weekly_pay_audit(
    v_batch.org_id, 'payment_batch_bank_submitted', 'payment_batch', v_batch.id,
    v_actor, NULL,
    jsonb_build_object(
      'has_note', v_batch.bank_submission_note IS NOT NULL,
      'has_file_ref', v_batch.bank_file_ref IS NOT NULL
    )
  );
  RETURN public.regapro_mask_weekly_pay_payment_batch(v_batch);
END;
$$;

DROP FUNCTION IF EXISTS public.record_weekly_pay_batch_item_results(uuid, jsonb);
CREATE OR REPLACE FUNCTION public.record_weekly_pay_batch_item_results(
  p_batch_id uuid,
  p_results jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_batch public.weekly_pay_payment_batches;
  v_el jsonb;
  v_item public.weekly_pay_payment_batch_items;
  v_outcome text;
  v_paid_on date;
  v_pending integer;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  IF p_results IS NULL OR jsonb_typeof(p_results) <> 'array' OR jsonb_array_length(p_results) = 0 THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_SELECTION: results required';
  END IF;

  PERFORM set_config('regapro.weekly_pay_rpc', '1', true);
  SELECT * INTO v_batch FROM public.weekly_pay_payment_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WEEKLY_PAY_NOT_FOUND: payment batch';
  END IF;
  IF NOT public.regapro_staff_belongs_to_org(v_batch.org_id) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: cross-org denied' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    public.regapro_staff_has_permission(v_batch.org_id, 'weekly_pay.pay')
    OR public.regapro_staff_has_permission(v_batch.org_id, 'weekly_pay.manage')
  ) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: weekly_pay.pay required' USING ERRCODE = '42501';
  END IF;
  IF v_batch.status NOT IN ('bank_submitted', 'settling') THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_TRANSITION: results require bank_submitted|settling (status=%)', v_batch.status;
  END IF;

  FOR v_el IN SELECT * FROM jsonb_array_elements(p_results)
  LOOP
    SELECT * INTO v_item
    FROM public.weekly_pay_payment_batch_items
    WHERE id = (v_el->>'itemId')::uuid AND batch_id = v_batch.id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'WEEKLY_PAY_NOT_FOUND: batch item';
    END IF;
    IF v_item.outcome = 'paid' THEN
      RAISE EXCEPTION 'WEEKLY_PAY_INVALID_TRANSITION: item already paid';
    END IF;
    IF v_item.outcome = 'cancelled' THEN
      RAISE EXCEPTION 'WEEKLY_PAY_INVALID_TRANSITION: item cancelled';
    END IF;

    v_outcome := v_el->>'outcome';
    IF v_outcome NOT IN ('paid', 'failed', 'unknown') THEN
      RAISE EXCEPTION 'WEEKLY_PAY_INVALID_SELECTION: outcome must be paid|failed|unknown';
    END IF;

    IF v_outcome = 'paid' THEN
      IF v_el->>'paidOn' IS NULL THEN
        RAISE EXCEPTION 'WEEKLY_PAY_INVALID_SELECTION: paidOn required for paid outcome';
      END IF;
      v_paid_on := (v_el->>'paidOn')::date;
      IF v_el->>'bankTransactionRef' IS NULL OR btrim(v_el->>'bankTransactionRef') = '' THEN
        RAISE EXCEPTION 'WEEKLY_PAY_INVALID_SELECTION: bankTransactionRef required for paid';
      END IF;
      IF v_el->>'evidenceNote' IS NULL OR btrim(v_el->>'evidenceNote') = '' THEN
        RAISE EXCEPTION 'WEEKLY_PAY_INVALID_SELECTION: evidenceNote required for paid';
      END IF;

      UPDATE public.weekly_pay_payment_batch_items
        SET outcome = 'paid',
            paid_on = v_paid_on,
            confirmed_by_staff_id = v_actor,
            bank_transaction_ref = btrim(v_el->>'bankTransactionRef'),
            evidence_note = btrim(v_el->>'evidenceNote'),
            settled_at = now()
      WHERE id = v_item.id;

      INSERT INTO public.weekly_pay_settlement_ledger (
        org_id, staff_id, application_id, batch_item_id, work_record_ids,
        week_start, week_end, amount_yen, paid_on, confirmed_by_staff_id,
        bank_transaction_ref, evidence_note
      ) VALUES (
        v_item.org_id, v_item.staff_id, v_item.application_id, v_item.id, v_item.work_record_ids,
        v_item.week_start, v_item.week_end, v_item.amount_yen, v_paid_on, v_actor,
        btrim(v_el->>'bankTransactionRef'), btrim(v_el->>'evidenceNote')
      );

      PERFORM public.regapro_write_weekly_pay_audit(
        v_batch.org_id, 'payment_item_paid', 'payment_batch_item', v_item.id,
        v_actor, v_item.staff_id,
        jsonb_build_object(
          'application_id', v_item.application_id,
          'amount_yen', v_item.amount_yen,
          'paid_on', v_paid_on,
          'has_bank_ref', true
        )
      );
    ELSIF v_outcome = 'failed' THEN
      IF v_el->>'bankTransactionRef' IS NULL OR btrim(v_el->>'bankTransactionRef') = '' THEN
        RAISE EXCEPTION 'WEEKLY_PAY_INVALID_SELECTION: bankTransactionRef required for failed';
      END IF;
      IF v_el->>'evidenceNote' IS NULL OR btrim(v_el->>'evidenceNote') = '' THEN
        RAISE EXCEPTION 'WEEKLY_PAY_INVALID_SELECTION: evidenceNote required for failed';
      END IF;
      UPDATE public.weekly_pay_payment_batch_items
        SET outcome = 'failed',
            failure_reason = COALESCE(NULLIF(btrim(v_el->>'failureReason'), ''), 'failed'),
            confirmed_by_staff_id = v_actor,
            bank_transaction_ref = btrim(v_el->>'bankTransactionRef'),
            evidence_note = btrim(v_el->>'evidenceNote'),
            settled_at = now()
      WHERE id = v_item.id;

      PERFORM public.regapro_write_weekly_pay_audit(
        v_batch.org_id, 'payment_item_failed', 'payment_batch_item', v_item.id,
        v_actor, v_item.staff_id,
        jsonb_build_object(
          'application_id', v_item.application_id,
          'failure_reason', COALESCE(NULLIF(btrim(v_el->>'failureReason'), ''), 'failed')
        )
      );
    ELSE
      IF v_el->>'evidenceNote' IS NULL OR btrim(v_el->>'evidenceNote') = '' THEN
        RAISE EXCEPTION 'WEEKLY_PAY_INVALID_SELECTION: evidenceNote required for unknown';
      END IF;
      UPDATE public.weekly_pay_payment_batch_items
        SET outcome = 'unknown',
            confirmed_by_staff_id = v_actor,
            evidence_note = btrim(v_el->>'evidenceNote'),
            bank_transaction_ref = NULLIF(btrim(v_el->>'bankTransactionRef'), ''),
            settled_at = now()
      WHERE id = v_item.id;

      PERFORM public.regapro_write_weekly_pay_audit(
        v_batch.org_id, 'payment_item_unknown', 'payment_batch_item', v_item.id,
        v_actor, v_item.staff_id,
        jsonb_build_object('application_id', v_item.application_id)
      );
    END IF;
  END LOOP;

  SELECT count(*) INTO v_pending
  FROM public.weekly_pay_payment_batch_items
  WHERE batch_id = v_batch.id AND outcome = 'pending';

  UPDATE public.weekly_pay_payment_batches
    SET status = CASE
          WHEN v_pending = 0 AND NOT EXISTS (
            SELECT 1 FROM public.weekly_pay_payment_batch_items
            WHERE batch_id = v_batch.id AND outcome = 'unknown'
          ) THEN 'closed'
          ELSE 'settling'
        END,
        closed_at = CASE
          WHEN v_pending = 0 AND NOT EXISTS (
            SELECT 1 FROM public.weekly_pay_payment_batch_items
            WHERE batch_id = v_batch.id AND outcome = 'unknown'
          ) THEN now()
          ELSE closed_at
        END,
        updated_at = now()
  WHERE id = v_batch.id
  RETURNING * INTO v_batch;

  RETURN public.regapro_mask_weekly_pay_payment_batch(v_batch);
END;
$$;

-- Strict resend release: bank confirmation kind + ref + evidence required.
-- Replaces free-text resolve_weekly_pay_unknown_item path for rebatch eligibility.
DROP FUNCTION IF EXISTS public.resolve_weekly_pay_unknown_item(uuid, text, text);
DROP FUNCTION IF EXISTS public.release_weekly_pay_item_for_resend(uuid, text, text, text);
CREATE OR REPLACE FUNCTION public.release_weekly_pay_item_for_resend(
  p_item_id uuid,
  p_bank_confirmation_kind text,
  p_bank_transaction_ref text,
  p_evidence_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_item public.weekly_pay_payment_batch_items;
  v_batch public.weekly_pay_payment_batches;
  v_kind text := btrim(p_bank_confirmation_kind);
  v_ref text := btrim(p_bank_transaction_ref);
  v_note text := btrim(p_evidence_note);
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  IF v_kind IS NULL OR v_kind NOT IN ('not_executed', 'failed_at_bank') THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_SELECTION: bank_confirmation_kind must be not_executed|failed_at_bank';
  END IF;
  IF v_ref IS NULL OR char_length(v_ref) < 1 THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_SELECTION: bank_transaction_ref required';
  END IF;
  IF v_note IS NULL OR char_length(v_note) < 8 THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_SELECTION: evidence_note required (min 8 chars)';
  END IF;

  PERFORM set_config('regapro.weekly_pay_rpc', '1', true);
  SELECT * INTO v_item FROM public.weekly_pay_payment_batch_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WEEKLY_PAY_NOT_FOUND: batch item';
  END IF;
  SELECT * INTO v_batch FROM public.weekly_pay_payment_batches WHERE id = v_item.batch_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WEEKLY_PAY_NOT_FOUND: payment batch';
  END IF;
  IF NOT public.regapro_staff_belongs_to_org(v_item.org_id) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: cross-org denied' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    public.regapro_staff_has_permission(v_item.org_id, 'weekly_pay.pay')
    OR public.regapro_staff_has_permission(v_item.org_id, 'weekly_pay.manage')
  ) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: weekly_pay.pay required' USING ERRCODE = '42501';
  END IF;
  IF v_batch.status NOT IN ('bank_submitted', 'settling', 'closed') THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_TRANSITION: release requires post-submission batch';
  END IF;
  IF v_item.outcome NOT IN ('unknown', 'pending') THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_TRANSITION: only unknown|pending items can be released for resend';
  END IF;

  UPDATE public.weekly_pay_payment_batch_items
    SET outcome = 'failed',
        failure_reason = v_kind,
        confirmed_by_staff_id = v_actor,
        bank_transaction_ref = v_ref,
        evidence_note = v_note,
        settled_at = now()
  WHERE id = v_item.id
  RETURNING * INTO v_item;

  PERFORM public.regapro_write_weekly_pay_audit(
    v_item.org_id, 'payment_item_released_for_resend', 'payment_batch_item', v_item.id,
    v_actor, v_item.staff_id,
    jsonb_build_object(
      'application_id', v_item.application_id,
      'bank_confirmation_kind', v_kind,
      'has_bank_ref', true
    )
  );
  RETURN public.regapro_mask_weekly_pay_batch_item(v_item);
END;
$$;

-- Compatibility stub: old resolve RPC now requires bank evidence fields via new RPC.
CREATE OR REPLACE FUNCTION public.resolve_weekly_pay_unknown_item(
  p_item_id uuid,
  p_outcome text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'WEEKLY_PAY_INVALID_TRANSITION: use release_weekly_pay_item_for_resend with bank confirmation kind, bank_transaction_ref, and evidence_note'
    USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION public.regapro_service_load_batch_csv_payload(
  p_batch_id uuid,
  p_actor_staff_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch public.weekly_pay_payment_batches;
  v_org uuid;
  v_items jsonb;
  v_sum bigint := 0;
  v_cnt integer := 0;
  v_source_number text;
  v_transferor jsonb;
BEGIN
  IF NOT public.regapro_weekly_pay_service_role() THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: service_role only' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_batch FROM public.weekly_pay_payment_batches WHERE id = p_batch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WEEKLY_PAY_NOT_FOUND: payment batch';
  END IF;
  v_org := v_batch.org_id;

  IF p_actor_staff_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.staff s
    WHERE s.staff_id = p_actor_staff_id AND s.org_id = v_org AND s.status = 'active'
  ) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: invalid actor' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    public.regapro_staff_id_has_permission(p_actor_staff_id, v_org, 'weekly_pay.pay')
    OR public.regapro_staff_id_has_permission(p_actor_staff_id, v_org, 'weekly_pay.manage')
  ) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: actor lacks weekly_pay.pay' USING ERRCODE = '42501';
  END IF;

  IF v_batch.status IN ('cancelled', 'superseded') THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_TRANSITION: cannot export batch in %', v_batch.status;
  END IF;

  v_source_number := public.regapro_decrypt_bank_account_number_cipher(
    v_batch.transferor_account_number_ciphertext
  );

  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.staff_id, x.application_id), '[]'::jsonb),
         COALESCE(sum((x.amount_yen)::bigint), 0),
         count(*)::integer
  INTO v_items, v_sum, v_cnt
  FROM (
    SELECT
      i.id AS item_id,
      i.application_id,
      i.staff_id,
      i.amount_yen,
      i.bank_snapshot->>'bankCode' AS bank_code,
      i.bank_snapshot->>'bankName' AS bank_name,
      i.bank_snapshot->>'branchCode' AS branch_code,
      i.bank_snapshot->>'branchName' AS branch_name,
      i.bank_snapshot->>'accountType' AS account_type,
      i.bank_snapshot->>'accountHolderKana' AS account_holder_kana,
      i.bank_snapshot->>'accountNumberLast4' AS account_number_last4,
      public.regapro_decrypt_bank_account_number_cipher(i.account_number_ciphertext) AS account_number
    FROM public.weekly_pay_payment_batch_items i
    WHERE i.batch_id = v_batch.id AND i.outcome <> 'cancelled'
  ) x;

  IF v_cnt <> v_batch.item_count OR v_sum <> v_batch.total_amount_yen THEN
    RAISE EXCEPTION 'WEEKLY_PAY_TOTAL_MISMATCH: csv totals do not match sealed batch';
  END IF;

  v_transferor := (
    COALESCE(v_batch.transferor_snapshot, '{}'::jsonb)
      - 'sourceAccountNumber'
      - 'sourceAccountNumberCiphertext'
  ) || jsonb_build_object('sourceAccountNumber', v_source_number);

  PERFORM public.regapro_write_weekly_pay_audit(
    v_org, 'payment_batch_csv_payload_decrypted', 'payment_batch', v_batch.id,
    p_actor_staff_id, NULL,
    jsonb_build_object(
      'item_count', v_cnt,
      'total_amount_yen', v_sum,
      'content_fingerprint', v_batch.content_fingerprint,
      'transferor_decrypted', true
    )
  );

  RETURN jsonb_build_object(
    'batchId', v_batch.id,
    'orgId', v_batch.org_id,
    'bankTransferDate', v_batch.bank_transfer_date,
    'contentFingerprint', v_batch.content_fingerprint,
    'itemCount', v_batch.item_count,
    'totalAmountYen', v_batch.total_amount_yen,
    'transferor', v_transferor,
    'items', v_items
  );
END;
$$;

-- EXECUTE ACL
REVOKE ALL ON FUNCTION public.create_weekly_pay_payment_batch(uuid[], date, date)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cancel_weekly_pay_payment_batch(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_weekly_pay_batch_export(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_weekly_pay_batch_bank_submission(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_weekly_pay_batch_item_results(uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_weekly_pay_unknown_item(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.release_weekly_pay_item_for_resend(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_weekly_pay_transferor_settings_masked()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.upsert_weekly_pay_transferor_settings(text, text, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_service_load_batch_csv_payload(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_is_japanese_bank_business_day(date)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.create_weekly_pay_payment_batch(uuid[], date, date)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_weekly_pay_payment_batch(uuid, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_weekly_pay_batch_export(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_weekly_pay_batch_bank_submission(uuid, text, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_weekly_pay_batch_item_results(uuid, jsonb)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_weekly_pay_unknown_item(uuid, text, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_weekly_pay_item_for_resend(uuid, text, text, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_weekly_pay_transferor_settings_masked()
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_weekly_pay_transferor_settings(text, text, text, text, text, text, text, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regapro_is_japanese_bank_business_day(date)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regapro_service_load_batch_csv_payload(uuid, uuid)
  TO service_role;

-- Refresh ACL probe matrix entries (same row shape as Phase 4/6)
CREATE OR REPLACE FUNCTION public.regapro_weekly_pay_acl_privileges()
RETURNS TABLE (
  grantee text,
  function_identity text,
  kind text,
  can_execute boolean
)
LANGUAGE sql
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
      ('public.upsert_bank_account_masked(text, text, text, text, text, text, text, uuid)', 'business'),
      ('public.deactivate_bank_account_masked(uuid)', 'business'),
      ('public.upsert_worker_settings(boolean, uuid, uuid)', 'business'),
      ('public.get_weekly_pay_transferor_settings_masked()', 'business'),
      ('public.upsert_weekly_pay_transferor_settings(text, text, text, text, text, text, text, text)', 'business'),
      ('public.create_weekly_pay_payment_batch(uuid[], date, date)', 'business'),
      ('public.cancel_weekly_pay_payment_batch(uuid, text)', 'business'),
      ('public.record_weekly_pay_batch_export(uuid)', 'business'),
      ('public.record_weekly_pay_batch_bank_submission(uuid, text, text)', 'business'),
      ('public.record_weekly_pay_batch_item_results(uuid, jsonb)', 'business'),
      ('public.resolve_weekly_pay_unknown_item(uuid, text, text)', 'business'),
      ('public.release_weekly_pay_item_for_resend(uuid, text, text, text)', 'business'),
      ('public.regapro_is_japanese_bank_business_day(date)', 'business'),
      ('public.regapro_has_any_weekly_pay_permission(uuid)', 'rls_helper'),
      ('public.regapro_service_load_batch_csv_payload(uuid, uuid)', 'service_only'),
      ('public.regapro_staff_id_has_permission(uuid, uuid, text)', 'internal'),
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
      ('public.regapro_work_record_weekly_pay_guard()', 'internal'),
      ('public.regapro_weekly_pay_bank_dek()', 'internal'),
      ('public.regapro_encrypt_bank_account_number(text)', 'internal'),
      ('public.regapro_decrypt_bank_account_number_cipher(bytea)', 'internal'),
      ('public.regapro_resolve_active_bank_account(uuid, uuid)', 'internal'),
      ('public.regapro_write_application_bank_snapshot(uuid, uuid, uuid)', 'internal'),
      ('public.regapro_bank_account_mutation_guard()', 'internal'),
      ('public.regapro_worker_settings_mutation_guard()', 'internal'),
      ('public.regapro_application_bank_snapshot_mutation_guard()', 'internal'),
      ('public.regapro_bank_account_to_masked(public.bank_accounts)', 'internal'),
      ('public.upsert_bank_account(text, text, text, text, text, text, text, uuid)', 'internal'),
      ('public.deactivate_bank_account(uuid)', 'internal'),
      ('public.decrypt_application_bank_account_number(uuid)', 'internal'),
      ('public.regapro_weekly_pay_payment_mutation_guard()', 'internal'),
      ('public.regapro_mask_weekly_pay_payment_batch(public.weekly_pay_payment_batches)', 'internal'),
      ('public.regapro_mask_weekly_pay_batch_item(public.weekly_pay_payment_batch_items)', 'internal')
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

REVOKE ALL ON FUNCTION public.regapro_weekly_pay_acl_privileges()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regapro_weekly_pay_acl_privileges()
  TO service_role;
