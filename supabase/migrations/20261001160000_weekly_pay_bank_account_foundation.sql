-- Phase 5: Bank Account / Application Bank Snapshot
-- Forward-only. Does not edit Phase 4 migrations.
-- Account numbers encrypted with AES via pgcrypto; DEK in Supabase Vault.
-- Snapshots are taken atomically when creating/replacing a draft application.
-- Plaintext account numbers are never exposed via SELECT policies or normal RPCs.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- Vault DEK bootstrap (idempotent)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_existing uuid;
  v_key text;
BEGIN
  SELECT id INTO v_existing
  FROM vault.secrets
  WHERE name = 'regapro_weekly_pay_bank_dek'
  LIMIT 1;
  IF v_existing IS NULL THEN
    v_key := encode(extensions.gen_random_bytes(32), 'hex');
    PERFORM vault.create_secret(
      v_key,
      'regapro_weekly_pay_bank_dek',
      'AES data-encryption key for weekly pay bank account numbers (Phase 5+)'
    );
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
CREATE TABLE public.bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  staff_id uuid NOT NULL REFERENCES public.staff(staff_id),
  bank_name text NOT NULL,
  bank_code text NOT NULL,
  branch_name text NOT NULL,
  branch_code text NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('ordinary', 'current')),
  account_number_ciphertext bytea NOT NULL,
  account_number_last4 text NOT NULL,
  account_holder_kana text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by_staff_id uuid NOT NULL REFERENCES public.staff(staff_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz,
  CONSTRAINT bank_accounts_bank_code_chk CHECK (bank_code ~ '^\d{4}$'),
  CONSTRAINT bank_accounts_branch_code_chk CHECK (branch_code ~ '^\d{3}$'),
  CONSTRAINT bank_accounts_last4_chk CHECK (account_number_last4 ~ '^\d{4}$'),
  CONSTRAINT bank_accounts_holder_kana_chk CHECK (char_length(btrim(account_holder_kana)) BETWEEN 1 AND 60)
);

CREATE INDEX bank_accounts_org_staff_idx
  ON public.bank_accounts (org_id, staff_id, status);

CREATE UNIQUE INDEX bank_accounts_one_active_per_staff_uidx
  ON public.bank_accounts (org_id, staff_id)
  WHERE status = 'active';

COMMENT ON TABLE public.bank_accounts IS
  'Worker transfer destinations. account_number is ciphertext only; last4 is for masked display.';
COMMENT ON COLUMN public.bank_accounts.account_number_ciphertext IS
  'pgp_sym_encrypt(account_number, vault DEK). Never SELECT-exposed as plaintext.';

CREATE TABLE public.worker_settings (
  staff_id uuid PRIMARY KEY REFERENCES public.staff(staff_id),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  weekly_pay_enabled boolean NOT NULL DEFAULT true,
  active_bank_account_id uuid REFERENCES public.bank_accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX worker_settings_org_idx ON public.worker_settings (org_id);

COMMENT ON TABLE public.worker_settings IS
  'Per-staff weekly-pay preferences. active_bank_account_id must belong to the same staff.';

CREATE TABLE public.application_bank_snapshots (
  application_id uuid PRIMARY KEY REFERENCES public.weekly_applications(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  staff_id uuid NOT NULL REFERENCES public.staff(staff_id),
  source_bank_account_id uuid,
  bank_name text NOT NULL,
  bank_code text NOT NULL,
  branch_name text NOT NULL,
  branch_code text NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('ordinary', 'current')),
  account_number_ciphertext bytea NOT NULL,
  account_number_last4 text NOT NULL,
  account_holder_kana text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT application_bank_snapshots_last4_chk CHECK (account_number_last4 ~ '^\d{4}$')
);

CREATE INDEX application_bank_snapshots_org_staff_idx
  ON public.application_bank_snapshots (org_id, staff_id);

COMMENT ON TABLE public.application_bank_snapshots IS
  'Immutable transfer destination frozen at weekly application draft create/replace. Not updated when bank_accounts change.';

-- ---------------------------------------------------------------------------
-- Crypto helpers (internal)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.regapro_weekly_pay_bank_dek()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  v_key text;
BEGIN
  SELECT ds.decrypted_secret INTO v_key
  FROM vault.decrypted_secrets ds
  WHERE ds.name = 'regapro_weekly_pay_bank_dek'
  LIMIT 1;
  IF v_key IS NULL OR length(v_key) < 32 THEN
    RAISE EXCEPTION 'WEEKLY_PAY_BANK_KEY_MISSING: bank DEK is not configured';
  END IF;
  RETURN v_key;
END;
$$;

CREATE OR REPLACE FUNCTION public.regapro_encrypt_bank_account_number(p_account_number text)
RETURNS bytea
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF p_account_number IS NULL OR p_account_number !~ '^\d{7,8}$' THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_BANK: account_number must be 7 or 8 digits';
  END IF;
  RETURN extensions.pgp_sym_encrypt(
    p_account_number,
    public.regapro_weekly_pay_bank_dek(),
    'cipher-algo=aes256'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.regapro_decrypt_bank_account_number_cipher(p_ciphertext bytea)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF p_ciphertext IS NULL THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_BANK: missing ciphertext';
  END IF;
  RETURN extensions.pgp_sym_decrypt(
    p_ciphertext,
    public.regapro_weekly_pay_bank_dek()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.regapro_bank_account_last4(p_account_number text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT right(p_account_number, 4);
$$;

-- ---------------------------------------------------------------------------
-- Mutation guards
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.regapro_touch_bank_updated_at()
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

CREATE TRIGGER trg_bank_accounts_touch
  BEFORE UPDATE ON public.bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public.regapro_touch_bank_updated_at();

CREATE TRIGGER trg_worker_settings_touch
  BEFORE UPDATE ON public.worker_settings
  FOR EACH ROW EXECUTE FUNCTION public.regapro_touch_bank_updated_at();

CREATE OR REPLACE FUNCTION public.regapro_bank_account_mutation_guard()
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
  RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: mutate bank_accounts via RPC only'
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER trg_bank_accounts_mutation_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public.regapro_bank_account_mutation_guard();

CREATE OR REPLACE FUNCTION public.regapro_worker_settings_mutation_guard()
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
  RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: mutate worker_settings via RPC only'
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER trg_worker_settings_mutation_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.worker_settings
  FOR EACH ROW EXECUTE FUNCTION public.regapro_worker_settings_mutation_guard();

CREATE OR REPLACE FUNCTION public.regapro_application_bank_snapshot_mutation_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  -- Snapshots are immutable after insert, including for service_role fixture cleanup
  -- which must DELETE (allowed below) but never UPDATE.
  IF TG_OP = 'DELETE' THEN
    IF public.regapro_weekly_pay_rpc_active() OR public.regapro_weekly_pay_service_role() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: delete application_bank_snapshots via RPC only'
      USING ERRCODE = '42501';
  END IF;
  RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: application_bank_snapshots are immutable'
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER trg_application_bank_snapshots_mutation_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.application_bank_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.regapro_application_bank_snapshot_mutation_guard();

-- ---------------------------------------------------------------------------
-- Active bank resolution + snapshot writer
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.regapro_resolve_active_bank_account(
  p_org_id uuid,
  p_staff_id uuid
)
RETURNS public.bank_accounts
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acc public.bank_accounts;
  v_settings public.worker_settings;
BEGIN
  SELECT * INTO v_settings
  FROM public.worker_settings ws
  WHERE ws.staff_id = p_staff_id AND ws.org_id = p_org_id;

  IF FOUND AND v_settings.weekly_pay_enabled IS FALSE THEN
    RAISE EXCEPTION 'WEEKLY_PAY_NO_BANK: weekly pay is disabled for this staff';
  END IF;

  IF FOUND AND v_settings.active_bank_account_id IS NOT NULL THEN
    SELECT * INTO v_acc
    FROM public.bank_accounts ba
    WHERE ba.id = v_settings.active_bank_account_id
      AND ba.org_id = p_org_id
      AND ba.staff_id = p_staff_id
      AND ba.status = 'active';
    IF FOUND THEN
      RETURN v_acc;
    END IF;
  END IF;

  SELECT * INTO v_acc
  FROM public.bank_accounts ba
  WHERE ba.org_id = p_org_id
    AND ba.staff_id = p_staff_id
    AND ba.status = 'active'
  ORDER BY ba.updated_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WEEKLY_PAY_NO_BANK: active bank account is required';
  END IF;
  RETURN v_acc;
END;
$$;

CREATE OR REPLACE FUNCTION public.regapro_write_application_bank_snapshot(
  p_application_id uuid,
  p_org_id uuid,
  p_staff_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acc public.bank_accounts;
BEGIN
  v_acc := public.regapro_resolve_active_bank_account(p_org_id, p_staff_id);

  DELETE FROM public.application_bank_snapshots
  WHERE application_id = p_application_id;

  INSERT INTO public.application_bank_snapshots (
    application_id, org_id, staff_id, source_bank_account_id,
    bank_name, bank_code, branch_name, branch_code, account_type,
    account_number_ciphertext, account_number_last4, account_holder_kana
  ) VALUES (
    p_application_id, p_org_id, p_staff_id, v_acc.id,
    v_acc.bank_name, v_acc.bank_code, v_acc.branch_name, v_acc.branch_code, v_acc.account_type,
    v_acc.account_number_ciphertext, v_acc.account_number_last4, v_acc.account_holder_kana
  );

  PERFORM public.regapro_write_weekly_pay_audit(
    p_org_id, 'weekly_application_bank_snapshotted', 'weekly_application', p_application_id,
    public.regapro_current_staff_id(), p_staff_id,
    jsonb_build_object(
      'source_bank_account_id', v_acc.id,
      'account_number_last4', v_acc.account_number_last4,
      'bank_code', v_acc.bank_code,
      'branch_code', v_acc.branch_code
    )
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Business RPCs: bank + settings
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_bank_account(
  p_bank_name text,
  p_bank_code text,
  p_branch_name text,
  p_branch_code text,
  p_account_type text,
  p_account_number text,
  p_account_holder_kana text,
  p_for_staff_id uuid DEFAULT NULL
)
RETURNS public.bank_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_org uuid;
  v_target uuid;
  v_acc public.bank_accounts;
  v_cipher bytea;
  v_last4 text;
  v_name text := btrim(p_bank_name);
  v_branch text := btrim(p_branch_name);
  v_holder text := btrim(p_account_holder_kana);
  v_number text := btrim(p_account_number);
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  SELECT s.org_id INTO v_org FROM public.staff s
  WHERE s.staff_id = v_actor AND s.status = 'active';
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;

  v_target := COALESCE(p_for_staff_id, v_actor);
  IF v_target <> v_actor
     AND NOT public.regapro_staff_has_permission(v_org, 'weekly_pay.manage') THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: cannot manage another staff bank account'
      USING ERRCODE = '42501';
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

  IF v_name IS NULL OR char_length(v_name) = 0 OR char_length(v_name) > 80 THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_BANK: bank_name invalid';
  END IF;
  IF p_bank_code IS NULL OR p_bank_code !~ '^\d{4}$' THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_BANK: bank_code must be 4 digits';
  END IF;
  IF v_branch IS NULL OR char_length(v_branch) = 0 OR char_length(v_branch) > 80 THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_BANK: branch_name invalid';
  END IF;
  IF p_branch_code IS NULL OR p_branch_code !~ '^\d{3}$' THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_BANK: branch_code must be 3 digits';
  END IF;
  IF p_account_type IS NULL OR p_account_type NOT IN ('ordinary', 'current') THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_BANK: account_type invalid';
  END IF;
  IF v_number IS NULL OR v_number !~ '^\d{7,8}$' THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_BANK: account_number must be 7 or 8 digits';
  END IF;
  IF v_holder IS NULL OR char_length(v_holder) = 0 OR char_length(v_holder) > 60 THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_BANK: account_holder_kana invalid';
  END IF;
  IF v_holder !~ '^[ァ-ヶー　 ]+$' THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_BANK: account_holder_kana must be katakana';
  END IF;

  v_cipher := public.regapro_encrypt_bank_account_number(v_number);
  v_last4 := public.regapro_bank_account_last4(v_number);

  PERFORM set_config('regapro.weekly_pay_rpc', '1', true);

  UPDATE public.bank_accounts
    SET status = 'inactive',
        deactivated_at = now()
  WHERE org_id = v_org
    AND staff_id = v_target
    AND status = 'active';

  INSERT INTO public.bank_accounts (
    org_id, staff_id, bank_name, bank_code, branch_name, branch_code,
    account_type, account_number_ciphertext, account_number_last4,
    account_holder_kana, status, created_by_staff_id
  ) VALUES (
    v_org, v_target, v_name, p_bank_code, v_branch, p_branch_code,
    p_account_type, v_cipher, v_last4, v_holder, 'active', v_actor
  )
  RETURNING * INTO v_acc;

  INSERT INTO public.worker_settings (staff_id, org_id, weekly_pay_enabled, active_bank_account_id)
  VALUES (v_target, v_org, true, v_acc.id)
  ON CONFLICT (staff_id) DO UPDATE
    SET org_id = EXCLUDED.org_id,
        active_bank_account_id = EXCLUDED.active_bank_account_id,
        updated_at = now();

  PERFORM public.regapro_write_weekly_pay_audit(
    v_org, 'bank_account_upserted', 'bank_account', v_acc.id,
    v_actor, v_target,
    jsonb_build_object(
      'account_number_last4', v_last4,
      'bank_code', p_bank_code,
      'branch_code', p_branch_code,
      'account_type', p_account_type
    )
  );
  RETURN v_acc;
END;
$$;

CREATE OR REPLACE FUNCTION public.deactivate_bank_account(p_bank_account_id uuid)
RETURNS public.bank_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_acc public.bank_accounts;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('regapro.weekly_pay_rpc', '1', true);

  SELECT * INTO v_acc FROM public.bank_accounts WHERE id = p_bank_account_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WEEKLY_PAY_NOT_FOUND: bank account';
  END IF;
  IF NOT public.regapro_staff_belongs_to_org(v_acc.org_id) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: cross-org denied' USING ERRCODE = '42501';
  END IF;
  IF v_acc.staff_id <> v_actor
     AND NOT public.regapro_staff_has_permission(v_acc.org_id, 'weekly_pay.manage') THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: cannot deactivate another staff bank account'
      USING ERRCODE = '42501';
  END IF;
  IF v_acc.staff_id = v_actor AND NOT (
    public.regapro_staff_has_permission(v_acc.org_id, 'weekly_pay.submit')
    OR public.regapro_staff_has_permission(v_acc.org_id, 'weekly_pay.manage')
  ) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: weekly_pay.submit required' USING ERRCODE = '42501';
  END IF;
  IF v_acc.status = 'inactive' THEN
    RETURN v_acc;
  END IF;

  UPDATE public.bank_accounts
    SET status = 'inactive',
        deactivated_at = now()
  WHERE id = v_acc.id
  RETURNING * INTO v_acc;

  UPDATE public.worker_settings
    SET active_bank_account_id = NULL,
        updated_at = now()
  WHERE staff_id = v_acc.staff_id
    AND active_bank_account_id = v_acc.id;

  PERFORM public.regapro_write_weekly_pay_audit(
    v_acc.org_id, 'bank_account_deactivated', 'bank_account', v_acc.id,
    v_actor, v_acc.staff_id,
    jsonb_build_object('account_number_last4', v_acc.account_number_last4)
  );
  RETURN v_acc;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_worker_settings(
  p_weekly_pay_enabled boolean,
  p_active_bank_account_id uuid DEFAULT NULL,
  p_for_staff_id uuid DEFAULT NULL
)
RETURNS public.worker_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_org uuid;
  v_target uuid;
  v_settings public.worker_settings;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  SELECT s.org_id INTO v_org FROM public.staff s
  WHERE s.staff_id = v_actor AND s.status = 'active';
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  v_target := COALESCE(p_for_staff_id, v_actor);
  IF v_target <> v_actor
     AND NOT public.regapro_staff_has_permission(v_org, 'weekly_pay.manage') THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: cannot manage another staff settings'
      USING ERRCODE = '42501';
  END IF;
  IF v_target = v_actor AND NOT (
    public.regapro_staff_has_permission(v_org, 'weekly_pay.submit')
    OR public.regapro_staff_has_permission(v_org, 'weekly_pay.manage')
  ) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: weekly_pay.submit required' USING ERRCODE = '42501';
  END IF;

  IF p_active_bank_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.bank_accounts ba
    WHERE ba.id = p_active_bank_account_id
      AND ba.org_id = v_org
      AND ba.staff_id = v_target
      AND ba.status = 'active'
  ) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_INVALID_BANK: active_bank_account_id must be an active own account';
  END IF;

  PERFORM set_config('regapro.weekly_pay_rpc', '1', true);

  INSERT INTO public.worker_settings (
    staff_id, org_id, weekly_pay_enabled, active_bank_account_id
  ) VALUES (
    v_target, v_org, COALESCE(p_weekly_pay_enabled, true), p_active_bank_account_id
  )
  ON CONFLICT (staff_id) DO UPDATE
    SET weekly_pay_enabled = EXCLUDED.weekly_pay_enabled,
        active_bank_account_id = EXCLUDED.active_bank_account_id,
        org_id = EXCLUDED.org_id,
        updated_at = now()
  RETURNING * INTO v_settings;

  PERFORM public.regapro_write_weekly_pay_audit(
    v_org, 'worker_settings_upserted', 'worker_settings', v_target,
    v_actor, v_target,
    jsonb_build_object(
      'weekly_pay_enabled', v_settings.weekly_pay_enabled,
      'has_active_bank', v_settings.active_bank_account_id IS NOT NULL
    )
  );
  RETURN v_settings;
END;
$$;

-- Payer/manage decrypt for Phase 6 CSV prep. Audited. Not for normal UI.
CREATE OR REPLACE FUNCTION public.decrypt_application_bank_account_number(p_application_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_snap public.application_bank_snapshots;
  v_plain text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_snap
  FROM public.application_bank_snapshots s
  WHERE s.application_id = p_application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WEEKLY_PAY_NOT_FOUND: bank snapshot';
  END IF;
  IF NOT public.regapro_staff_belongs_to_org(v_snap.org_id) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: cross-org denied' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    public.regapro_staff_has_permission(v_snap.org_id, 'weekly_pay.pay')
    OR public.regapro_staff_has_permission(v_snap.org_id, 'weekly_pay.manage')
  ) THEN
    RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: weekly_pay.pay required to decrypt'
      USING ERRCODE = '42501';
  END IF;

  v_plain := public.regapro_decrypt_bank_account_number_cipher(v_snap.account_number_ciphertext);

  PERFORM public.regapro_write_weekly_pay_audit(
    v_snap.org_id, 'application_bank_number_decrypted', 'weekly_application', p_application_id,
    v_actor, v_snap.staff_id,
    jsonb_build_object('account_number_last4', v_snap.account_number_last4)
  );
  RETURN v_plain;
END;
$$;

-- ---------------------------------------------------------------------------
-- Replace draft RPC: require bank + write snapshot atomically
-- Decision: on returned/draft replace, refresh snapshot from current active bank.
-- Submitted/approved snapshots are never touched by bank_accounts updates.
-- ---------------------------------------------------------------------------
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

  -- Fail early if no transferable bank destination (no silent bank-less draft).
  PERFORM public.regapro_resolve_active_bank_account(v_org, v_target);

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
  DELETE FROM _wp_calc WHERE TRUE;

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

  -- Atomic bank snapshot (refresh on draft/returned replace).
  PERFORM public.regapro_write_application_bank_snapshot(v_app.id, v_org, v_target);

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

-- ---------------------------------------------------------------------------
-- RLS: masked columns only (ciphertext never granted to authenticated)
-- ---------------------------------------------------------------------------
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_bank_snapshots ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.bank_accounts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.worker_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.application_bank_snapshots FROM PUBLIC, anon, authenticated;

GRANT SELECT (
  id, org_id, staff_id, bank_name, bank_code, branch_name, branch_code,
  account_type, account_number_last4, account_holder_kana, status,
  created_by_staff_id, created_at, updated_at, deactivated_at
) ON public.bank_accounts TO authenticated;

GRANT SELECT (
  staff_id, org_id, weekly_pay_enabled, active_bank_account_id, created_at, updated_at
) ON public.worker_settings TO authenticated;

GRANT SELECT (
  application_id, org_id, staff_id, source_bank_account_id,
  bank_name, bank_code, branch_name, branch_code, account_type,
  account_number_last4, account_holder_kana, created_at
) ON public.application_bank_snapshots TO authenticated;

CREATE POLICY bank_accounts_select ON public.bank_accounts
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

CREATE POLICY worker_settings_select ON public.worker_settings
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

CREATE POLICY application_bank_snapshots_select ON public.application_bank_snapshots
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

-- ---------------------------------------------------------------------------
-- EXECUTE ACL (Phase 3.6: no default PUBLIC EXECUTE)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.regapro_weekly_pay_bank_dek() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_encrypt_bank_account_number(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_decrypt_bank_account_number_cipher(bytea) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_bank_account_last4(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_touch_bank_updated_at() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_bank_account_mutation_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_worker_settings_mutation_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_application_bank_snapshot_mutation_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_resolve_active_bank_account(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_write_application_bank_snapshot(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.upsert_bank_account(text, text, text, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.deactivate_bank_account(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.upsert_worker_settings(boolean, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.decrypt_application_bank_account_number(uuid) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.upsert_bank_account(text, text, text, text, text, text, text, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.deactivate_bank_account(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_worker_settings(boolean, uuid, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decrypt_application_bank_account_number(uuid)
  TO authenticated, service_role;

-- create_or_replace_weekly_application_draft grants preserved by CREATE OR REPLACE.

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
      ('public.upsert_bank_account(text, text, text, text, text, text, text, uuid)', 'business'),
      ('public.deactivate_bank_account(uuid)', 'business'),
      ('public.upsert_worker_settings(boolean, uuid, uuid)', 'business'),
      ('public.decrypt_application_bank_account_number(uuid)', 'business'),
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
      ('public.regapro_work_record_weekly_pay_guard()', 'internal'),
      ('public.regapro_weekly_pay_bank_dek()', 'internal'),
      ('public.regapro_encrypt_bank_account_number(text)', 'internal'),
      ('public.regapro_decrypt_bank_account_number_cipher(bytea)', 'internal'),
      ('public.regapro_resolve_active_bank_account(uuid, uuid)', 'internal'),
      ('public.regapro_write_application_bank_snapshot(uuid, uuid, uuid)', 'internal'),
      ('public.regapro_bank_account_mutation_guard()', 'internal'),
      ('public.regapro_worker_settings_mutation_guard()', 'internal'),
      ('public.regapro_application_bank_snapshot_mutation_guard()', 'internal')
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
