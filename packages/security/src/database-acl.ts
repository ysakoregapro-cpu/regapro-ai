/**
 * Legacy database ACL contract.
 * Matches supabase/migrations/20260928093819_legacy_rpc_acl_hardening.sql
 *
 * Phase 2/3 Shift / Work Record identities live in @regapro/work work-rpc-acl
 * and are intentionally not duplicated here.
 */

export const LEGACY_SERVICE_ONLY_IDENTITIES = [
  "public.regapro_backfill_staff_from_auth(uuid, text, uuid)",
  "public.regapro_next_staff_no(uuid)",
  "public.regapro_membership_ai_permissions(uuid, uuid)",
  "public.regapro_staff_platform_permissions(uuid, uuid)",
  "public.regapro_derive_platform_roles_from_ai_permissions(text[])",
  "public.regapro_expected_platform_permissions_from_ai(text[])",
] as const;

export const LEGACY_RLS_HELPER_IDENTITIES = [
  "public.regapro_is_org_member(uuid)",
  "public.regapro_is_project_member(uuid)",
  "public.regapro_has_permission(uuid, text)",
  "public.regapro_can_read_org(uuid)",
  "public.regapro_current_staff_id()",
  "public.regapro_staff_belongs_to_org(uuid)",
  "public.regapro_staff_has_permission(uuid, text)",
  "public.regapro_can_manage_staff(uuid)",
  "public.regapro_can_manage_roles(uuid)",
  "public.regapro_can_access_confidentiality_level(uuid, integer)",
  "public.regapro_can_assign_confidentiality_level(uuid, integer)",
  "public.regapro_can_access_labeled_row(uuid, integer, text, uuid, uuid, uuid, uuid)",
  "public.regapro_can_access_thread(uuid)",
  "public.regapro_can_access_storage_object(text, text)",
  "public.regapro_has_conversation_audit_access(uuid)",
] as const;

export const LEGACY_OWNER_ONLY_IDENTITIES = [
  "public.regapro_can_access_resource(uuid, integer, text, uuid, uuid, uuid)",
  "public.regapro_can_read_private_thread(uuid)",
  "public.regapro_effective_clearance_level(uuid)",
  "public.regapro_current_membership_id(uuid)",
  "public.regapro_is_active_org_member(uuid)",
  "public.regapro_can_access_visibility(uuid, text, uuid, uuid, uuid)",
  "public.regapro_can_manage_resource(uuid, text, uuid)",
  "public.regapro_current_user_id()",
  "public.regapro_level_to_int(text)",
] as const;

export const LEGACY_KNOWLEDGE_AUTHENTICATED_IDENTITIES = [
  "public.regapro_knowledge_lexical_search(text, integer)",
  "public.regapro_knowledge_vector_search(vector, integer)",
  "public.regapro_knowledge_chunk_retrievable(uuid)",
  "public.regapro_claim_knowledge_ingestion_job(uuid, integer, text)",
  "public.regapro_claim_knowledge_source_chunks(uuid, integer, integer, boolean)",
] as const;

/** Worker-only claim RPCs — none in this phase (factory uses user JWT). */
export const LEGACY_KNOWLEDGE_SERVICE_ONLY_IDENTITIES = [] as const;

export const LEGACY_DATABASE_ACL = {
  business: { anon: false, authenticated: true, service_role: true },
  rls_helper: { anon: false, authenticated: true, service_role: true },
  service_only: { anon: false, authenticated: false, service_role: true },
  owner_only: { anon: false, authenticated: false, service_role: false },
  knowledge_authenticated: { anon: false, authenticated: true, service_role: true },
  knowledge_service_only: { anon: false, authenticated: false, service_role: true },
} as const;

export type LegacyAclKind = keyof typeof LEGACY_DATABASE_ACL;

export function expectedLegacyExecute(
  kind: LegacyAclKind,
  role: "anon" | "authenticated" | "service_role",
): boolean {
  return LEGACY_DATABASE_ACL[kind][role];
}
