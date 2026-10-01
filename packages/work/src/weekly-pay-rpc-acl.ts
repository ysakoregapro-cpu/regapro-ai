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
  "public.upsert_bank_account_masked(text, text, text, text, text, text, text, uuid)",
  "public.deactivate_bank_account_masked(uuid)",
  "public.upsert_worker_settings(boolean, uuid, uuid)",
  "public.get_weekly_pay_transferor_settings_masked()",
  "public.upsert_weekly_pay_transferor_settings(text, text, text, text, text, text, text, text)",
  "public.create_weekly_pay_payment_batch(uuid[], date, date)",
  "public.cancel_weekly_pay_payment_batch(uuid, text)",
  "public.record_weekly_pay_batch_export(uuid)",
  "public.record_weekly_pay_batch_bank_submission(uuid, text, text)",
  "public.record_weekly_pay_batch_item_results(uuid, jsonb)",
  "public.resolve_weekly_pay_unknown_item(uuid, text, text)",
  "public.release_weekly_pay_item_for_resend(uuid, text, text, text)",
  "public.regapro_is_japanese_bank_business_day(date)",
] as const;

export const WEEKLY_PAY_SERVICE_ONLY_RPC_IDENTITIES = [
  "public.regapro_service_load_batch_csv_payload(uuid, uuid)",
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
  "public.regapro_weekly_pay_bank_dek()",
  "public.regapro_encrypt_bank_account_number(text)",
  "public.regapro_decrypt_bank_account_number_cipher(bytea)",
  "public.regapro_resolve_active_bank_account(uuid, uuid)",
  "public.regapro_write_application_bank_snapshot(uuid, uuid, uuid)",
  "public.regapro_bank_account_mutation_guard()",
  "public.regapro_worker_settings_mutation_guard()",
  "public.regapro_application_bank_snapshot_mutation_guard()",
  "public.regapro_bank_account_to_masked(public.bank_accounts)",
  "public.upsert_bank_account(text, text, text, text, text, text, text, uuid)",
  "public.deactivate_bank_account(uuid)",
  "public.decrypt_application_bank_account_number(uuid)",
  "public.regapro_weekly_pay_payment_mutation_guard()",
  "public.regapro_staff_id_has_permission(uuid, uuid, text)",
  "public.regapro_mask_weekly_pay_payment_batch(public.weekly_pay_payment_batches)",
  "public.regapro_mask_weekly_pay_batch_item(public.weekly_pay_payment_batch_items)",
] as const;

export const WEEKLY_PAY_RPC_ACL = {
  business: { anon: false, authenticated: true, service_role: true },
  rlsHelper: { anon: false, authenticated: true, service_role: true },
  serviceOnly: { anon: false, authenticated: false, service_role: true },
  internal: { anon: false, authenticated: false, service_role: false },
} as const;

export function expectedWeeklyPayExecute(
  kind: keyof typeof WEEKLY_PAY_RPC_ACL,
  role: "anon" | "authenticated" | "service_role",
): boolean {
  return WEEKLY_PAY_RPC_ACL[kind][role];
}
