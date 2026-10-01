-- Phase 6: Weekly pay payment batches, SMTB transferor settings, settlement ledger.
-- Decrypt remains unavailable to authenticated Data API; CSV payload is service_role-only.
-- Forward-only; does not edit prior weekly-pay migrations.

-- ---------------------------------------------------------------------------
-- Japanese bank holidays (weekends handled in function)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.japanese_bank_holidays (
  holiday_date date PRIMARY KEY,
  name text NOT NULL
);

INSERT INTO public.japanese_bank_holidays (holiday_date, name) VALUES
  ('2025-01-01', '元日'), ('2025-01-13', '成人の日'), ('2025-02-11', '建国記念の日'),
  ('2025-02-23', '天皇誕生日'), ('2025-02-24', '振替休日'), ('2025-03-20', '春分の日'),
  ('2025-04-29', '昭和の日'), ('2025-05-03', '憲法記念日'), ('2025-05-04', 'みどりの日'),
  ('2025-05-05', 'こどもの日'), ('2025-05-06', '振替休日'), ('2025-07-21', '海の日'),
  ('2025-08-11', '山の日'), ('2025-09-15', '敬老の日'), ('2025-09-23', '秋分の日'),
  ('2025-10-13', 'スポーツの日'), ('2025-11-03', '文化の日'), ('2025-11-23', '勤労感謝の日'),
  ('2025-11-24', '振替休日'),
  ('2026-01-01', '元日'), ('2026-01-12', '成人の日'), ('2026-02-11', '建国記念の日'),
  ('2026-02-23', '天皇誕生日'), ('2026-03-20', '春分の日'), ('2026-04-29', '昭和の日'),
  ('2026-05-03', '憲法記念日'), ('2026-05-04', 'みどりの日'), ('2026-05-05', 'こどもの日'),
  ('2026-05-06', '振替休日'), ('2026-07-20', '海の日'), ('2026-08-11', '山の日'),
  ('2026-09-21', '敬老の日'), ('2026-09-22', '国民の休日'), ('2026-09-23', '秋分の日'),
  ('2026-10-12', 'スポーツの日'), ('2026-11-03', '文化の日'), ('2026-11-23', '勤労感謝の日'),
  ('2027-01-01', '元日'), ('2027-01-11', '成人の日'), ('2027-02-11', '建国記念の日'),
  ('2027-02-23', '天皇誕生日'), ('2027-03-21', '春分の日'), ('2027-03-22', '振替休日'),
  ('2027-04-29', '昭和の日'), ('2027-05-03', '憲法記念日'), ('2027-05-04', 'みどりの日'),
  ('2027-05-05', 'こどもの日'), ('2027-07-19', '海の日'), ('2027-08-11', '山の日'),
  ('2027-09-20', '敬老の日'), ('2027-09-23', '秋分の日'), ('2027-10-11', 'スポーツの日'),
  ('2027-11-03', '文化の日'), ('2027-11-23', '勤労感謝の日')
ON CONFLICT (holiday_date) DO NOTHING;

ALTER TABLE public.japanese_bank_holidays ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.regapro_is_japanese_bank_business_day(p_date date)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    EXTRACT(ISODOW FROM p_date) BETWEEN 1 AND 5
    AND NOT EXISTS (
      SELECT 1 FROM public.japanese_bank_holidays h WHERE h.holiday_date = p_date
    );
$$;

REVOKE ALL ON FUNCTION public.regapro_is_japanese_bank_business_day(date)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regapro_is_japanese_bank_business_day(date)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Transferor settings (SMTB 総合振込 — org scoped, never hardcode real codes)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.weekly_pay_transferor_settings (
  org_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  consignor_code text NOT NULL,
  requester_name_kana text NOT NULL,
  source_bank_code text NOT NULL DEFAULT '0038',
  source_bank_name_kana text,
  source_branch_code text NOT NULL,
  source_branch_name_kana text,
  source_account_type text NOT NULL DEFAULT 'ordinary'
    CHECK (source_account_type IN ('ordinary', 'current')),
  source_account_number text NOT NULL,
  updated_by_staff_id uuid REFERENCES public.staff(staff_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT weekly_pay_transferor_consignor_chk CHECK (consignor_code ~ '^20\d{8}$'),
  CONSTRAINT weekly_pay_transferor_bank_chk CHECK (source_bank_code ~ '^\d{4}$'),
  CONSTRAINT weekly_pay_transferor_branch_chk CHECK (source_branch_code ~ '^\d{3}$'),
  CONSTRAINT weekly_pay_transferor_account_chk CHECK (source_account_number ~ '^\d{7}$'),
  CONSTRAINT weekly_pay_transferor_name_chk CHECK (
    char_length(btrim(requester_name_kana)) BETWEEN 1 AND 40
  )
);

CREATE TABLE IF NOT EXISTS public.weekly_pay_payment_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  status text NOT NULL
    CHECK (status IN (
      'confirmed', 'exported', 'bank_submitted', 'settling', 'closed', 'cancelled', 'superseded'
    )),
  bank_transfer_date date NOT NULL,
  scheduled_payment_date date,
  format_code text NOT NULL DEFAULT 'docomo_smtb_sogo_csv_v1',
  item_count integer NOT NULL CHECK (item_count >= 0),
  total_amount_yen bigint NOT NULL CHECK (total_amount_yen >= 0),
  content_fingerprint text NOT NULL,
  transferor_snapshot jsonb NOT NULL,
  supersedes_batch_id uuid REFERENCES public.weekly_pay_payment_batches(id),
  superseded_by_batch_id uuid REFERENCES public.weekly_pay_payment_batches(id),
  created_by_staff_id uuid NOT NULL REFERENCES public.staff(staff_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  cancelled_by_staff_id uuid REFERENCES public.staff(staff_id),
  cancel_reason text,
  exported_at timestamptz,
  export_count integer NOT NULL DEFAULT 0,
  bank_submitted_at timestamptz,
  bank_submission_note text,
  bank_file_ref text,
  closed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_wp_payment_batches_org_date
  ON public.weekly_pay_payment_batches (org_id, bank_transfer_date DESC);

CREATE TABLE IF NOT EXISTS public.weekly_pay_payment_batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.weekly_pay_payment_batches(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  application_id uuid NOT NULL REFERENCES public.weekly_applications(id),
  staff_id uuid NOT NULL REFERENCES public.staff(staff_id),
  amount_yen integer NOT NULL CHECK (amount_yen > 0),
  week_start date NOT NULL,
  week_end date NOT NULL,
  application_payment_date date NOT NULL,
  work_record_ids uuid[] NOT NULL,
  policy_snapshot jsonb NOT NULL,
  bank_snapshot jsonb NOT NULL,
  account_number_ciphertext bytea NOT NULL,
  outcome text NOT NULL DEFAULT 'pending'
    CHECK (outcome IN ('pending', 'paid', 'failed', 'unknown', 'cancelled')),
  paid_on date,
  confirmed_by_staff_id uuid REFERENCES public.staff(staff_id),
  bank_transaction_ref text,
  evidence_note text,
  failure_reason text,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, application_id)
);

-- One application may not sit in multiple in-flight / paid / unknown lines.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wp_payment_app_active_item
  ON public.weekly_pay_payment_batch_items (application_id)
  WHERE outcome IN ('pending', 'unknown', 'paid');

CREATE INDEX IF NOT EXISTS idx_wp_payment_items_batch
  ON public.weekly_pay_payment_batch_items (batch_id);

CREATE TABLE IF NOT EXISTS public.weekly_pay_settlement_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  staff_id uuid NOT NULL REFERENCES public.staff(staff_id),
  application_id uuid NOT NULL REFERENCES public.weekly_applications(id),
  batch_item_id uuid NOT NULL REFERENCES public.weekly_pay_payment_batch_items(id),
  work_record_ids uuid[] NOT NULL,
  week_start date NOT NULL,
  week_end date NOT NULL,
  amount_yen integer NOT NULL CHECK (amount_yen > 0),
  paid_on date NOT NULL,
  confirmed_by_staff_id uuid NOT NULL REFERENCES public.staff(staff_id),
  bank_transaction_ref text,
  evidence_note text,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_wp_settlement_app_active
  ON public.weekly_pay_settlement_ledger (application_id)
  WHERE voided_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_wp_settlement_staff
  ON public.weekly_pay_settlement_ledger (org_id, staff_id, paid_on DESC);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.weekly_pay_transferor_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_pay_payment_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_pay_payment_batch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_pay_settlement_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY wp_transferor_select ON public.weekly_pay_transferor_settings
  FOR SELECT TO authenticated
  USING (
    public.regapro_staff_belongs_to_org(org_id)
    AND (
      public.regapro_staff_has_permission(org_id, 'weekly_pay.pay')
      OR public.regapro_staff_has_permission(org_id, 'weekly_pay.manage')
    )
  );

CREATE POLICY wp_batches_select ON public.weekly_pay_payment_batches
  FOR SELECT TO authenticated
  USING (
    public.regapro_staff_belongs_to_org(org_id)
    AND (
      public.regapro_staff_has_permission(org_id, 'weekly_pay.pay')
      OR public.regapro_staff_has_permission(org_id, 'weekly_pay.manage')
    )
  );

CREATE POLICY wp_batch_items_select ON public.weekly_pay_payment_batch_items
  FOR SELECT TO authenticated
  USING (
    public.regapro_staff_belongs_to_org(org_id)
    AND (
      public.regapro_staff_has_permission(org_id, 'weekly_pay.pay')
      OR public.regapro_staff_has_permission(org_id, 'weekly_pay.manage')
      OR public.regapro_current_staff_id() = staff_id
    )
  );

-- Staff see own settlement; pay/manage see org.
CREATE POLICY wp_settlement_select ON public.weekly_pay_settlement_ledger
  FOR SELECT TO authenticated
  USING (
    public.regapro_staff_belongs_to_org(org_id)
    AND (
      public.regapro_current_staff_id() = staff_id
      OR public.regapro_staff_has_permission(org_id, 'weekly_pay.pay')
      OR public.regapro_staff_has_permission(org_id, 'weekly_pay.manage')
    )
  );

-- No direct writes; RPC only.
CREATE OR REPLACE FUNCTION public.regapro_weekly_pay_payment_mutation_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF public.regapro_weekly_pay_rpc_active() OR public.regapro_weekly_pay_service_role() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: payment tables are RPC-only' USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_wp_transferor_guard ON public.weekly_pay_transferor_settings;
CREATE TRIGGER trg_wp_transferor_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.weekly_pay_transferor_settings
  FOR EACH ROW EXECUTE FUNCTION public.regapro_weekly_pay_payment_mutation_guard();

DROP TRIGGER IF EXISTS trg_wp_batches_guard ON public.weekly_pay_payment_batches;
CREATE TRIGGER trg_wp_batches_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.weekly_pay_payment_batches
  FOR EACH ROW EXECUTE FUNCTION public.regapro_weekly_pay_payment_mutation_guard();

DROP TRIGGER IF EXISTS trg_wp_batch_items_guard ON public.weekly_pay_payment_batch_items;
CREATE TRIGGER trg_wp_batch_items_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.weekly_pay_payment_batch_items
  FOR EACH ROW EXECUTE FUNCTION public.regapro_weekly_pay_payment_mutation_guard();

DROP TRIGGER IF EXISTS trg_wp_settlement_guard ON public.weekly_pay_settlement_ledger;
CREATE TRIGGER trg_wp_settlement_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.weekly_pay_settlement_ledger
  FOR EACH ROW EXECUTE FUNCTION public.regapro_weekly_pay_payment_mutation_guard();

-- Column grants: never expose ciphertext via SELECT
GRANT SELECT (
  id, batch_id, org_id, application_id, staff_id, amount_yen, week_start, week_end,
  application_payment_date, work_record_ids, policy_snapshot, bank_snapshot,
  outcome, paid_on, confirmed_by_staff_id, bank_transaction_ref, evidence_note,
  failure_reason, settled_at, created_at
) ON public.weekly_pay_payment_batch_items TO authenticated;

REVOKE ALL ON TABLE public.weekly_pay_transferor_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  org_id, consignor_code, requester_name_kana, source_bank_code, source_bank_name_kana,
  source_branch_code, source_branch_name_kana, source_account_type,
  updated_by_staff_id, created_at, updated_at
) ON public.weekly_pay_transferor_settings TO authenticated;
GRANT SELECT ON public.weekly_pay_payment_batches TO authenticated;
GRANT SELECT ON public.weekly_pay_settlement_ledger TO authenticated;

REVOKE ALL ON public.japanese_bank_holidays FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.japanese_bank_holidays TO authenticated, service_role;

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
    'source_account_number_last4', right(v_row.source_account_number, 4),
    'updated_at', v_row.updated_at
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Transferor upsert
-- ---------------------------------------------------------------------------
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
  IF v_name !~ '^[ｦ-ﾟ -\.\/0-9A-Z\(\)]+$' AND v_name !~ '^[ァ-ヶー　 A-Z0-9\(\)\.\-\/]+$' THEN
    -- Allow half-width kana/ASCII or full-width katakana; encoder validates Shift_JIS later.
    NULL;
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

  PERFORM set_config('regapro.weekly_pay_rpc', '1', true);

  INSERT INTO public.weekly_pay_transferor_settings (
    org_id, consignor_code, requester_name_kana, source_bank_code, source_bank_name_kana,
    source_branch_code, source_branch_name_kana, source_account_type, source_account_number,
    updated_by_staff_id
  ) VALUES (
    v_org, p_consignor_code, v_name, p_source_bank_code, NULLIF(btrim(p_source_bank_name_kana), ''),
    p_source_branch_code, NULLIF(btrim(p_source_branch_name_kana), ''),
    p_source_account_type, p_source_account_number, v_actor
  )
  ON CONFLICT (org_id) DO UPDATE SET
    consignor_code = EXCLUDED.consignor_code,
    requester_name_kana = EXCLUDED.requester_name_kana,
    source_bank_code = EXCLUDED.source_bank_code,
    source_bank_name_kana = EXCLUDED.source_bank_name_kana,
    source_branch_code = EXCLUDED.source_branch_code,
    source_branch_name_kana = EXCLUDED.source_branch_name_kana,
    source_account_type = EXCLUDED.source_account_type,
    source_account_number = EXCLUDED.source_account_number,
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
      'source_account_last4', right(p_source_account_number, 4)
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
    'source_account_number_last4', right(v_row.source_account_number, 4),
    'updated_at', v_row.updated_at
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Create confirmed payment batch
-- ---------------------------------------------------------------------------
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

  -- Lock candidate applications
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

  -- Reject destination account numbers that exceed SMTB CSV 7-digit field.
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
    digest(
      convert_to(
        v_org::text || '|' || p_bank_transfer_date::text || '|' ||
        (SELECT string_agg(x::text, ',' ORDER BY x) FROM unnest(v_ids) x) || '|' ||
        v_total::text || '|' || v_count::text || '|' || v_xfer.consignor_code,
        'UTF8'
      ),
      'sha256'
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

CREATE OR REPLACE FUNCTION public.cancel_weekly_pay_payment_batch(
  p_batch_id uuid,
  p_reason text
)
RETURNS public.weekly_pay_payment_batches
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
  IF v_batch.status IN ('cancelled', 'superseded', 'closed') THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_TRANSITION: batch cannot be cancelled from %', v_batch.status;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.weekly_pay_payment_batch_items i
    WHERE i.batch_id = v_batch.id AND i.outcome = 'paid'
  ) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_TRANSITION: cannot cancel batch with paid items';
  END IF;

  UPDATE public.weekly_pay_payment_batch_items
    SET outcome = 'cancelled', settled_at = now()
  WHERE batch_id = v_batch.id AND outcome IN ('pending', 'unknown', 'failed');

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
  RETURN v_batch;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_weekly_pay_batch_export(p_batch_id uuid)
RETURNS public.weekly_pay_payment_batches
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
  IF v_batch.status IN ('cancelled', 'superseded') THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_TRANSITION: cannot export cancelled/superseded batch';
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
  RETURN v_batch;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_weekly_pay_batch_bank_submission(
  p_batch_id uuid,
  p_note text DEFAULT NULL,
  p_bank_file_ref text DEFAULT NULL
)
RETURNS public.weekly_pay_payment_batches
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
  IF v_batch.status NOT IN ('exported', 'bank_submitted', 'settling', 'confirmed') THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_TRANSITION: cannot record bank submission from %', v_batch.status;
  END IF;

  UPDATE public.weekly_pay_payment_batches
    SET status = CASE
          WHEN status IN ('confirmed', 'exported') THEN 'bank_submitted'
          ELSE status
        END,
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
  RETURN v_batch;
END;
$$;

-- p_results: [{ "itemId": uuid, "outcome": "paid"|"failed"|"unknown", "paidOn": date?,
--              "bankTransactionRef": text?, "evidenceNote": text?, "failureReason": text? }]
CREATE OR REPLACE FUNCTION public.record_weekly_pay_batch_item_results(
  p_batch_id uuid,
  p_results jsonb
)
RETURNS public.weekly_pay_payment_batches
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
  IF v_batch.status IN ('cancelled', 'superseded', 'closed') THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_TRANSITION: batch is %', v_batch.status;
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
      UPDATE public.weekly_pay_payment_batch_items
        SET outcome = 'failed',
            failure_reason = COALESCE(NULLIF(btrim(v_el->>'failureReason'), ''), 'failed'),
            confirmed_by_staff_id = v_actor,
            evidence_note = NULLIF(btrim(v_el->>'evidenceNote'), ''),
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
      -- unknown: blocks re-batch until resolved to paid/failed
      UPDATE public.weekly_pay_payment_batch_items
        SET outcome = 'unknown',
            confirmed_by_staff_id = v_actor,
            evidence_note = NULLIF(btrim(v_el->>'evidenceNote'), ''),
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

  RETURN v_batch;
END;
$$;

-- Resolve unknown → failed so the application can be re-batched (not paid).
CREATE OR REPLACE FUNCTION public.resolve_weekly_pay_unknown_item(
  p_item_id uuid,
  p_outcome text,
  p_reason text DEFAULT NULL
)
RETURNS public.weekly_pay_payment_batch_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_item public.weekly_pay_payment_batch_items;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  IF p_outcome NOT IN ('failed', 'cancelled') THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_SELECTION: unknown may resolve to failed|cancelled only';
  END IF;
  PERFORM set_config('regapro.weekly_pay_rpc', '1', true);
  SELECT * INTO v_item FROM public.weekly_pay_payment_batch_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WEEKLY_PAY_NOT_FOUND: batch item';
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
  IF v_item.outcome <> 'unknown' THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_TRANSITION: item is not unknown';
  END IF;

  UPDATE public.weekly_pay_payment_batch_items
    SET outcome = p_outcome,
        failure_reason = COALESCE(NULLIF(btrim(p_reason), ''), p_outcome),
        confirmed_by_staff_id = v_actor,
        settled_at = now()
  WHERE id = v_item.id
  RETURNING * INTO v_item;

  PERFORM public.regapro_write_weekly_pay_audit(
    v_item.org_id, 'payment_item_unknown_resolved', 'payment_batch_item', v_item.id,
    v_actor, v_item.staff_id,
    jsonb_build_object('outcome', p_outcome)
  );
  RETURN v_item;
END;
$$;

-- Permission check for an explicit staff_id (service CSV path; not JWT-bound).
CREATE OR REPLACE FUNCTION public.regapro_staff_id_has_permission(
  p_staff_id uuid,
  p_org_id uuid,
  p_permission text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_staff_id IS NULL THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.staff_permission_overrides spo
    JOIN public.permissions p ON p.id = spo.permission_id AND p.deleted_at IS NULL
    WHERE spo.staff_id = p_staff_id
      AND spo.org_id = p_org_id
      AND spo.deleted_at IS NULL
      AND spo.effect = 'deny'
      AND (spo.expires_at IS NULL OR spo.expires_at > now())
      AND p.key = p_permission
  ) THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.staff_permission_overrides spo
    JOIN public.permissions p ON p.id = spo.permission_id AND p.deleted_at IS NULL
    WHERE spo.staff_id = p_staff_id
      AND spo.org_id = p_org_id
      AND spo.deleted_at IS NULL
      AND spo.effect = 'allow'
      AND (spo.expires_at IS NULL OR spo.expires_at > now())
      AND p.key = p_permission
  ) THEN
    RETURN true;
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM public.staff_role_assignments sra
    JOIN public.roles r ON r.id = sra.role_id AND r.deleted_at IS NULL
    JOIN public.role_permissions rp ON rp.role_id = r.id AND rp.deleted_at IS NULL
    JOIN public.permissions p ON p.id = rp.permission_id AND p.deleted_at IS NULL
    WHERE sra.staff_id = p_staff_id
      AND sra.org_id = p_org_id
      AND sra.deleted_at IS NULL
      AND (sra.expires_at IS NULL OR sra.expires_at > now())
      AND p.key = p_permission
  );
END;
$$;

REVOKE ALL ON FUNCTION public.regapro_staff_id_has_permission(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Service-role CSV payload (NOT granted to authenticated / anon)
-- Caller (Next.js) must verify JWT + pay permission, then pass actor_staff_id.
-- ---------------------------------------------------------------------------
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

  PERFORM public.regapro_write_weekly_pay_audit(
    v_org, 'payment_batch_csv_payload_decrypted', 'payment_batch', v_batch.id,
    p_actor_staff_id, NULL,
    jsonb_build_object(
      'item_count', v_cnt,
      'total_amount_yen', v_sum,
      'content_fingerprint', v_batch.content_fingerprint
    )
  );

  RETURN jsonb_build_object(
    'batchId', v_batch.id,
    'orgId', v_batch.org_id,
    'bankTransferDate', v_batch.bank_transfer_date,
    'contentFingerprint', v_batch.content_fingerprint,
    'itemCount', v_batch.item_count,
    'totalAmountYen', v_batch.total_amount_yen,
    'transferor', v_batch.transferor_snapshot,
    'items', v_items
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- EXECUTE ACL
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.regapro_weekly_pay_payment_mutation_guard()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_weekly_pay_transferor_settings_masked()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.upsert_weekly_pay_transferor_settings(text, text, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
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
REVOKE ALL ON FUNCTION public.regapro_service_load_batch_csv_payload(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_weekly_pay_transferor_settings_masked()
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_weekly_pay_transferor_settings(text, text, text, text, text, text, text, text)
  TO authenticated, service_role;
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
GRANT EXECUTE ON FUNCTION public.regapro_is_japanese_bank_business_day(date)
  TO authenticated, service_role;

-- service_role only — Next.js CSV path after JWT authz
GRANT EXECUTE ON FUNCTION public.regapro_service_load_batch_csv_payload(uuid, uuid)
  TO service_role;

-- Keep decrypt owner-only (no authenticated / service_role EXECUTE)
REVOKE ALL ON FUNCTION public.decrypt_application_bank_account_number(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Update ACL probe catalog
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
      ('public.regapro_weekly_pay_payment_mutation_guard()', 'internal')
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
