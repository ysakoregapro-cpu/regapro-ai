export const EXPENSE_BUSINESS_RPC_IDENTITIES = [
  "public.upsert_expense_application_draft(uuid, uuid, text, uuid, integer, date, text, text)",
  "public.submit_expense_application(uuid)",
  "public.return_expense_application(uuid, text)",
  "public.approve_expense_application(uuid)",
  "public.attach_expense_application_receipt(uuid, uuid)",
] as const;

export const EXPENSE_RLS_HELPER_IDENTITIES = [
  "public.regapro_has_any_expense_permission(uuid)",
] as const;

export const EXPENSE_INTERNAL_HELPER_IDENTITIES = [
  "public.regapro_expense_rpc_active()",
  "public.regapro_write_expense_event(uuid, text, text, uuid, uuid, uuid, jsonb)",
  "public.regapro_expense_application_mutation_guard()",
  "public.regapro_expense_category_mutation_guard()",
] as const;

export const EXPENSE_RPC_ACL = {
  business: { anon: false, authenticated: true, service_role: true },
  rlsHelper: { anon: false, authenticated: true, service_role: true },
  internal: { anon: false, authenticated: false, service_role: false },
} as const;

export function expectedExpenseExecute(
  kind: keyof typeof EXPENSE_RPC_ACL,
  role: "anon" | "authenticated" | "service_role",
): boolean {
  return EXPENSE_RPC_ACL[kind][role];
}
