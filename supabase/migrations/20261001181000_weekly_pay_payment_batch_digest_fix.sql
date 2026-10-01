-- Fix content fingerprint hashing (pgcrypto digest lives in extensions schema).
-- Also allow authenticated SELECT on holiday calendar (RLS was enabled with no policy).

DROP POLICY IF EXISTS japanese_bank_holidays_select ON public.japanese_bank_holidays;
CREATE POLICY japanese_bank_holidays_select ON public.japanese_bank_holidays
  FOR SELECT TO authenticated, service_role
  USING (true);

CREATE OR REPLACE FUNCTION public.create_weekly_pay_payment_batch(
  p_application_ids uuid[],
  p_bank_transfer_date date,
  p_scheduled_payment_date date DEFAULT NULL
)
RETURNS public.weekly_pay_payment_batches
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
    'sourceAccountNumber', v_xfer.source_account_number
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
        v_total::text || '|' || v_count::text || '|' || v_xfer.consignor_code,
        'UTF8'
      )
    ),
    'hex'
  );

  INSERT INTO public.weekly_pay_payment_batches (
    org_id, status, bank_transfer_date, scheduled_payment_date, item_count, total_amount_yen,
    content_fingerprint, transferor_snapshot, created_by_staff_id
  ) VALUES (
    v_org, 'confirmed', p_bank_transfer_date, p_scheduled_payment_date, v_count, v_total,
    v_fp, v_snap, v_actor
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
  RETURN v_batch;
END;
$$;

REVOKE ALL ON FUNCTION public.create_weekly_pay_payment_batch(uuid[], date, date)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_weekly_pay_payment_batch(uuid[], date, date)
  TO authenticated, service_role;
