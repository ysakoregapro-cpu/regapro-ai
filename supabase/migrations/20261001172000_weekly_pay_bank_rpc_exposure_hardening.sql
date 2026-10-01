-- Phase 5.1: Harden bank RPC Data API exposure (forward-only).
-- 1) Client-callable upsert/deactivate must not return ciphertext/plaintext.
-- 2) decrypt_application_bank_account_number is owner-only until Phase 6 CSV path.
-- Does not edit 20261001160000_weekly_pay_bank_account_foundation.

-- ---------------------------------------------------------------------------
-- Masked composite (no ciphertext, no plaintext account number)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'bank_account_masked'
  ) THEN
    CREATE TYPE public.bank_account_masked AS (
      id uuid,
      org_id uuid,
      staff_id uuid,
      bank_name text,
      bank_code text,
      branch_name text,
      branch_code text,
      account_type text,
      account_number_last4 text,
      account_holder_kana text,
      status text,
      created_by_staff_id uuid,
      deactivated_at timestamptz,
      created_at timestamptz,
      updated_at timestamptz
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.regapro_bank_account_to_masked(p_acc public.bank_accounts)
RETURNS public.bank_account_masked
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ROW(
    p_acc.id,
    p_acc.org_id,
    p_acc.staff_id,
    p_acc.bank_name,
    p_acc.bank_code,
    p_acc.branch_name,
    p_acc.branch_code,
    p_acc.account_type,
    p_acc.account_number_last4,
    p_acc.account_holder_kana,
    p_acc.status,
    p_acc.created_by_staff_id,
    p_acc.deactivated_at,
    p_acc.created_at,
    p_acc.updated_at
  )::public.bank_account_masked;
$$;

-- ---------------------------------------------------------------------------
-- Client-safe wrappers (authZ / audit remain in legacy internals)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_bank_account_masked(
  p_bank_name text,
  p_bank_code text,
  p_branch_name text,
  p_branch_code text,
  p_account_type text,
  p_account_number text,
  p_account_holder_kana text,
  p_for_staff_id uuid DEFAULT NULL
)
RETURNS public.bank_account_masked
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acc public.bank_accounts;
BEGIN
  v_acc := public.upsert_bank_account(
    p_bank_name,
    p_bank_code,
    p_branch_name,
    p_branch_code,
    p_account_type,
    p_account_number,
    p_account_holder_kana,
    p_for_staff_id
  );
  RETURN public.regapro_bank_account_to_masked(v_acc);
END;
$$;

CREATE OR REPLACE FUNCTION public.deactivate_bank_account_masked(p_bank_account_id uuid)
RETURNS public.bank_account_masked
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acc public.bank_accounts;
BEGIN
  v_acc := public.deactivate_bank_account(p_bank_account_id);
  RETURN public.regapro_bank_account_to_masked(v_acc);
END;
$$;

-- ---------------------------------------------------------------------------
-- EXECUTE ACL: revoke ciphertext-returning + decrypt from API roles
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.regapro_bank_account_to_masked(public.bank_accounts)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.upsert_bank_account(text, text, text, text, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.deactivate_bank_account(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.decrypt_application_bank_account_number(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.upsert_bank_account_masked(text, text, text, text, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.deactivate_bank_account_masked(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT USAGE ON TYPE public.bank_account_masked TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.upsert_bank_account_masked(text, text, text, text, text, text, text, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.deactivate_bank_account_masked(uuid)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- ACL privilege probe catalog
-- ---------------------------------------------------------------------------
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
      ('public.regapro_application_bank_snapshot_mutation_guard()', 'internal'),
      ('public.regapro_bank_account_to_masked(public.bank_accounts)', 'internal'),
      ('public.upsert_bank_account(text, text, text, text, text, text, text, uuid)', 'internal'),
      ('public.deactivate_bank_account(uuid)', 'internal'),
      ('public.decrypt_application_bank_account_number(uuid)', 'internal')
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
