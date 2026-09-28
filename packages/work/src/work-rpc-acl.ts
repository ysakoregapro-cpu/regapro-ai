/**
 * Phase 2 / Phase 3 SECURITY DEFINER EXECUTE contract.
 * Matches supabase/migrations/20260928091245_shift_work_rpc_acl_hardening.sql
 */

export const SHIFT_WORK_BUSINESS_RPC_IDENTITIES = [
  "public.create_or_replace_shift_request_draft(date, date, jsonb, uuid)",
  "public.submit_shift_request(uuid)",
  "public.cancel_shift_request(uuid)",
  "public.publish_shift(uuid)",
  "public.cancel_shift(uuid)",
  "public.create_employment_term(uuid, integer, date, date, boolean)",
  "public.revoke_employment_term(uuid, text)",
  "public.create_or_update_work_record_draft(uuid, uuid, date, time, time, smallint, integer, integer, uuid, uuid, text, text)",
  "public.confirm_work_record(uuid)",
  "public.reopen_work_record(uuid, text)",
  "public.void_work_record(uuid, text)",
] as const;

export const SHIFT_WORK_RLS_HELPER_IDENTITIES = [
  "public.regapro_has_any_shift_permission(uuid)",
  "public.regapro_has_any_work_record_permission(uuid)",
] as const;

export const SHIFT_WORK_INTERNAL_HELPER_IDENTITIES = [
  "public.regapro_shift_rpc_active()",
  "public.regapro_touch_updated_at()",
  "public.regapro_write_shift_audit(uuid, text, text, uuid, uuid, uuid, jsonb)",
  "public.regapro_shift_request_date_guard()",
  "public.regapro_shift_request_dates_delete_guard()",
  "public.regapro_shift_request_mutation_guard()",
  "public.regapro_shift_mutation_guard()",
  "public.regapro_shift_request_integrity()",
  "public.regapro_shift_integrity()",
  "public.regapro_work_rpc_active()",
  "public.regapro_write_work_audit(uuid, text, text, uuid, uuid, uuid, jsonb)",
  "public.regapro_work_record_snapshot(public.work_records)",
  "public.regapro_append_work_record_revision(public.work_records, text, uuid, jsonb, text)",
  "public.regapro_assert_staff_same_org(uuid, uuid, text)",
  "public.regapro_lock_employment_term_scope(uuid, uuid)",
  "public.regapro_employment_term_integrity()",
  "public.regapro_employment_term_mutation_guard()",
  "public.regapro_work_record_integrity()",
  "public.regapro_work_record_mutation_guard()",
  "public.regapro_work_record_revision_integrity()",
  "public.regapro_work_record_revision_mutation_guard()",
] as const;

export const SHIFT_WORK_RPC_ACL = {
  business: { anon: false, authenticated: true, service_role: true },
  rlsHelper: { anon: false, authenticated: true, service_role: true },
  internal: { anon: false, authenticated: false, service_role: false },
} as const;

export function expectedExecute(
  kind: keyof typeof SHIFT_WORK_RPC_ACL,
  role: "anon" | "authenticated" | "service_role",
): boolean {
  return SHIFT_WORK_RPC_ACL[kind][role];
}
