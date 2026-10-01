/**
 * Phase 4 Weekly Pay SECURITY DEFINER EXECUTE contract.
 * Matches supabase/migrations/20261001024933_weekly_pay_application_foundation.sql
 */

export const WEEKLY_PAY_BUSINESS_RPC_IDENTITIES = [
  "public.create_or_replace_weekly_application_draft(uuid[], uuid)",
  "public.submit_weekly_application(uuid)",
  "public.return_weekly_application(uuid, text)",
  "public.approve_weekly_application(uuid)",
  "public.upsert_weekly_pay_policy(integer, integer, text, integer, boolean, integer, integer, date, date)",
] as const;

export const WEEKLY_PAY_RLS_HELPER_IDENTITIES = [
  "public.regapro_has_any_weekly_pay_permission(uuid)",
] as const;

export const WEEKLY_PAY_INTERNAL_HELPER_IDENTITIES = [
  "public.regapro_weekly_pay_rpc_active()",
  "public.regapro_write_weekly_pay_audit(uuid, text, text, uuid, uuid, uuid, jsonb)",
  "public.regapro_weekly_pay_week_start(date, integer)",
  "public.regapro_weekly_pay_week_end(date)",
  "public.regapro_weekly_pay_cutoff_at(date)",
  "public.regapro_weekly_pay_payment_date(date, integer)",
  "public.regapro_weekly_pay_item_amount(integer, integer, integer, integer, boolean, integer)",
  "public.regapro_active_weekly_pay_policy(uuid, date)",
  "public.regapro_lock_weekly_pay_week(uuid, uuid, date)",
  "public.regapro_weekly_pay_service_role()",
  "public.regapro_weekly_application_mutation_guard()",
  "public.regapro_weekly_application_item_mutation_guard()",
  "public.regapro_weekly_pay_policy_mutation_guard()",
  "public.regapro_work_record_weekly_pay_guard()",
] as const;

export const WEEKLY_PAY_RPC_ACL = {
  business: { anon: false, authenticated: true, service_role: true },
  rlsHelper: { anon: false, authenticated: true, service_role: true },
  internal: { anon: false, authenticated: false, service_role: false },
} as const;

export function expectedWeeklyPayExecute(
  kind: keyof typeof WEEKLY_PAY_RPC_ACL,
  role: "anon" | "authenticated" | "service_role",
): boolean {
  return WEEKLY_PAY_RPC_ACL[kind][role];
}
