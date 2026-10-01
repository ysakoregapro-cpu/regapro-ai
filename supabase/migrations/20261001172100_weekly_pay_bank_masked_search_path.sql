-- Phase 5.1 follow-up: pin search_path on mask helper (Security Advisor WARN).
CREATE OR REPLACE FUNCTION public.regapro_bank_account_to_masked(p_acc public.bank_accounts)
RETURNS public.bank_account_masked
LANGUAGE sql
IMMUTABLE
SET search_path = public
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

REVOKE ALL ON FUNCTION public.regapro_bank_account_to_masked(public.bank_accounts)
  FROM PUBLIC, anon, authenticated, service_role;
