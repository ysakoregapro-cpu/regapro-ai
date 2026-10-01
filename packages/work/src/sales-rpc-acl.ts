export const SALES_BUSINESS_RPC_IDENTITIES = [
  "public.create_personal_sales_case(date, text, integer, text, uuid, jsonb, uuid)",
  "public.void_personal_sales_case(uuid, text)",
  "public.correct_personal_sales_case(uuid, date, text, integer, text, jsonb, text)",
  "public.upsert_personal_sales_allocation_rule_draft(date, date, jsonb)",
  "public.approve_personal_sales_allocation_rule(uuid)",
  "public.revoke_personal_sales_allocation_rule(uuid, text)",
] as const;

export const SALES_RLS_HELPER_IDENTITIES = [
  "public.regapro_has_any_sales_permission(uuid)",
] as const;

export const SALES_INTERNAL_HELPER_IDENTITIES = [
  "public.regapro_personal_sales_rpc_active()",
  "public.regapro_write_personal_sales_event(uuid, text, text, uuid, uuid, uuid, jsonb)",
  "public.regapro_personal_sales_case_mutation_guard()",
  "public.regapro_personal_sales_allocation_mutation_guard()",
  "public.regapro_personal_sales_rule_mutation_guard()",
] as const;

export const SALES_RPC_ACL = {
  business: { anon: false, authenticated: true, service_role: true },
  rlsHelper: { anon: false, authenticated: true, service_role: true },
  internal: { anon: false, authenticated: false, service_role: false },
} as const;

export function expectedSalesExecute(
  kind: keyof typeof SALES_RPC_ACL,
  role: "anon" | "authenticated" | "service_role",
): boolean {
  return SALES_RPC_ACL[kind][role];
}
