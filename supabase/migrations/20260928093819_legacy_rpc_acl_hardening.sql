-- Phase 3.6 Migration A: legacy Function / table ACL hardening.
-- Forward-only. Does not edit applied migrations.
-- Does not change Phase 2/3 Shift / Work Record RPC ACL
-- (see 20260928091245_shift_work_rpc_acl_hardening.sql).
--
-- REVOKE PUBLIC is not enough: default privileges also grant EXECUTE
-- to anon / authenticated / service_role directly.
-- Function bodies are unchanged.

-- ---------------------------------------------------------------------------
-- Maintenance RPCs — service_role only
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.regapro_backfill_staff_from_auth(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regapro_backfill_staff_from_auth(uuid, text, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.regapro_next_staff_no(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regapro_next_staff_no(uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.regapro_membership_ai_permissions(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regapro_membership_ai_permissions(uuid, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.regapro_staff_platform_permissions(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regapro_staff_platform_permissions(uuid, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.regapro_derive_platform_roles_from_ai_permissions(text[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regapro_derive_platform_roles_from_ai_permissions(text[])
  TO service_role;

REVOKE ALL ON FUNCTION public.regapro_expected_platform_permissions_from_ai(text[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regapro_expected_platform_permissions_from_ai(text[])
  TO service_role;

-- ---------------------------------------------------------------------------
-- Policy-direct RLS helpers — authenticated + service_role
-- Phase 2/3 helpers are already correct and are not listed here.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.regapro_is_org_member(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regapro_is_org_member(uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.regapro_is_project_member(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regapro_is_project_member(uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.regapro_has_permission(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regapro_has_permission(uuid, text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.regapro_can_read_org(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regapro_can_read_org(uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.regapro_current_staff_id()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regapro_current_staff_id()
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.regapro_staff_belongs_to_org(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regapro_staff_belongs_to_org(uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.regapro_staff_has_permission(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regapro_staff_has_permission(uuid, text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.regapro_can_manage_staff(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regapro_can_manage_staff(uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.regapro_can_manage_roles(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regapro_can_manage_roles(uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.regapro_can_access_confidentiality_level(uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regapro_can_access_confidentiality_level(uuid, integer)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.regapro_can_assign_confidentiality_level(uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regapro_can_assign_confidentiality_level(uuid, integer)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.regapro_can_access_labeled_row(uuid, integer, text, uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regapro_can_access_labeled_row(uuid, integer, text, uuid, uuid, uuid, uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.regapro_can_access_thread(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regapro_can_access_thread(uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.regapro_can_access_storage_object(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regapro_can_access_storage_object(text, text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.regapro_has_conversation_audit_access(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regapro_has_conversation_audit_access(uuid)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Nested SECURITY DEFINER internals — owner (postgres) only
-- Callers are themselves SECURITY DEFINER owned by postgres, so nested
-- EXECUTE continues to work without a direct grant.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.regapro_can_access_resource(uuid, integer, text, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_can_read_private_thread(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_effective_clearance_level(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Obsolete helpers — no policy / app / nested callers. Owner only.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.regapro_current_membership_id(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_is_active_org_member(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_can_access_visibility(uuid, text, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_can_manage_resource(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Unused INVOKER helpers (no policy / function / app callers). Owner only.
REVOKE ALL ON FUNCTION public.regapro_current_user_id()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_level_to_int(text)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Knowledge INVOKER RPCs — search/claim run with the caller's JWT
-- (apps/web knowledge factory uses createServerSupabaseClient).
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.regapro_knowledge_lexical_search(text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regapro_knowledge_lexical_search(text, integer)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.regapro_knowledge_vector_search(vector, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regapro_knowledge_vector_search(vector, integer)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.regapro_knowledge_chunk_retrievable(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regapro_knowledge_chunk_retrievable(uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.regapro_claim_knowledge_ingestion_job(uuid, integer, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regapro_claim_knowledge_ingestion_job(uuid, integer, text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.regapro_claim_knowledge_source_chunks(uuid, integer, integer, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regapro_claim_knowledge_source_chunks(uuid, integer, integer, boolean)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- staff_no_counters: keep RLS-on / no-policy deny-all. No new policies.
-- ---------------------------------------------------------------------------

REVOKE ALL ON TABLE public.staff_no_counters FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- service_role-only privilege snapshot for integration tests
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.regapro_legacy_acl_privileges()
RETURNS TABLE (
  grantee text,
  function_identity text,
  kind text,
  can_execute boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH identities(function_identity, kind) AS (
    VALUES
      ('public.regapro_backfill_staff_from_auth(uuid, text, uuid)', 'service_only'),
      ('public.regapro_next_staff_no(uuid)', 'service_only'),
      ('public.regapro_membership_ai_permissions(uuid, uuid)', 'service_only'),
      ('public.regapro_staff_platform_permissions(uuid, uuid)', 'service_only'),
      ('public.regapro_derive_platform_roles_from_ai_permissions(text[])', 'service_only'),
      ('public.regapro_expected_platform_permissions_from_ai(text[])', 'service_only'),
      ('public.regapro_is_org_member(uuid)', 'rls_helper'),
      ('public.regapro_is_project_member(uuid)', 'rls_helper'),
      ('public.regapro_has_permission(uuid, text)', 'rls_helper'),
      ('public.regapro_can_read_org(uuid)', 'rls_helper'),
      ('public.regapro_current_staff_id()', 'rls_helper'),
      ('public.regapro_staff_belongs_to_org(uuid)', 'rls_helper'),
      ('public.regapro_staff_has_permission(uuid, text)', 'rls_helper'),
      ('public.regapro_can_manage_staff(uuid)', 'rls_helper'),
      ('public.regapro_can_manage_roles(uuid)', 'rls_helper'),
      ('public.regapro_can_access_confidentiality_level(uuid, integer)', 'rls_helper'),
      ('public.regapro_can_assign_confidentiality_level(uuid, integer)', 'rls_helper'),
      ('public.regapro_can_access_labeled_row(uuid, integer, text, uuid, uuid, uuid, uuid)', 'rls_helper'),
      ('public.regapro_can_access_thread(uuid)', 'rls_helper'),
      ('public.regapro_can_access_storage_object(text, text)', 'rls_helper'),
      ('public.regapro_has_conversation_audit_access(uuid)', 'rls_helper'),
      ('public.regapro_can_access_resource(uuid, integer, text, uuid, uuid, uuid)', 'owner_only'),
      ('public.regapro_can_read_private_thread(uuid)', 'owner_only'),
      ('public.regapro_effective_clearance_level(uuid)', 'owner_only'),
      ('public.regapro_current_membership_id(uuid)', 'owner_only'),
      ('public.regapro_is_active_org_member(uuid)', 'owner_only'),
      ('public.regapro_can_access_visibility(uuid, text, uuid, uuid, uuid)', 'owner_only'),
      ('public.regapro_can_manage_resource(uuid, text, uuid)', 'owner_only'),
      ('public.regapro_current_user_id()', 'owner_only'),
      ('public.regapro_level_to_int(text)', 'owner_only'),
      ('public.regapro_knowledge_lexical_search(text, integer)', 'knowledge_authenticated'),
      ('public.regapro_knowledge_vector_search(vector, integer)', 'knowledge_authenticated'),
      ('public.regapro_knowledge_chunk_retrievable(uuid)', 'knowledge_authenticated'),
      ('public.regapro_claim_knowledge_ingestion_job(uuid, integer, text)', 'knowledge_authenticated'),
      ('public.regapro_claim_knowledge_source_chunks(uuid, integer, integer, boolean)', 'knowledge_authenticated')
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

COMMENT ON FUNCTION public.regapro_legacy_acl_privileges() IS
  'Read-only legacy function EXECUTE matrix for ACL tests. Not a business RPC.';

REVOKE ALL ON FUNCTION public.regapro_legacy_acl_privileges()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regapro_legacy_acl_privileges()
  TO service_role;

-- ---------------------------------------------------------------------------
-- Apply-time assertions
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(format('%s %s execute=%s', grantee, function_identity, can_execute), '; ')
    INTO v_bad
  FROM public.regapro_legacy_acl_privileges()
  WHERE (kind = 'service_only' AND (
          (grantee = 'service_role' AND NOT can_execute)
          OR (grantee IN ('anon', 'authenticated') AND can_execute)
        ))
     OR (kind = 'rls_helper' AND (
          (grantee = 'anon' AND can_execute)
          OR (grantee IN ('authenticated', 'service_role') AND NOT can_execute)
        ))
     OR (kind = 'owner_only' AND can_execute)
     OR (kind = 'knowledge_authenticated' AND (
          (grantee = 'anon' AND can_execute)
          OR (grantee IN ('authenticated', 'service_role') AND NOT can_execute)
        ));

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'LEGACY_ACL: unexpected EXECUTE grants: %', v_bad;
  END IF;

  IF has_function_privilege('anon', 'public.regapro_legacy_acl_privileges()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.regapro_legacy_acl_privileges()', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.regapro_legacy_acl_privileges()', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'LEGACY_ACL: privilege probe must be service_role-only';
  END IF;

  -- Phase 2/3 helpers must remain unchanged by this migration.
  IF has_function_privilege('anon', 'public.regapro_has_any_shift_permission(uuid)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.regapro_has_any_shift_permission(uuid)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.regapro_has_any_shift_permission(uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.regapro_has_any_work_record_permission(uuid)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.regapro_has_any_work_record_permission(uuid)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.regapro_has_any_work_record_permission(uuid)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'LEGACY_ACL: Phase 2/3 RLS helper ACL must remain authenticated+service_role';
  END IF;

  IF has_table_privilege('anon', 'public.staff_no_counters', 'SELECT')
    OR has_table_privilege('anon', 'public.staff_no_counters', 'INSERT')
    OR has_table_privilege('anon', 'public.staff_no_counters', 'UPDATE')
    OR has_table_privilege('authenticated', 'public.staff_no_counters', 'SELECT')
    OR has_table_privilege('authenticated', 'public.staff_no_counters', 'INSERT')
    OR has_table_privilege('authenticated', 'public.staff_no_counters', 'UPDATE')
  THEN
    RAISE EXCEPTION 'LEGACY_ACL: staff_no_counters must not be granted to anon/authenticated';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.staff_no_counters', 'SELECT')
    OR NOT has_table_privilege('service_role', 'public.staff_no_counters', 'INSERT')
    OR NOT has_table_privilege('service_role', 'public.staff_no_counters', 'UPDATE')
  THEN
    RAISE EXCEPTION 'LEGACY_ACL: service_role must keep staff_no_counters SELECT/INSERT/UPDATE';
  END IF;
END;
$$;
