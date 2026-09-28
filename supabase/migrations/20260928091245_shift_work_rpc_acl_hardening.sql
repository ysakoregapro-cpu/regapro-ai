-- Phase 2 / Phase 3 SECURITY DEFINER ACL hardening.
-- Forward-only: do not edit 20260925120000 or 20260925180000.
-- REVOKE PUBLIC is not enough; Supabase default privileges also grant
-- EXECUTE to anon / authenticated / service_role directly.
--
-- Trigger functions and internal helpers stay owner-only. They are all
-- SECURITY DEFINER. Trigger dispatch and nested PERFORM run as postgres,
-- so authenticated / service_role do not need a direct EXECUTE grant.

-- ---------------------------------------------------------------------------
-- Shift business RPCs
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.create_or_replace_shift_request_draft(date, date, jsonb, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_or_replace_shift_request_draft(date, date, jsonb, uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.submit_shift_request(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_shift_request(uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.cancel_shift_request(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_shift_request(uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.publish_shift(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.publish_shift(uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.cancel_shift(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_shift(uuid)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Work Record / Employment Term business RPCs
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.create_employment_term(uuid, integer, date, date, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_employment_term(uuid, integer, date, date, boolean)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.revoke_employment_term(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_employment_term(uuid, text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_or_update_work_record_draft(uuid, uuid, date, time, time, smallint, integer, integer, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_or_update_work_record_draft(uuid, uuid, date, time, time, smallint, integer, integer, uuid, uuid, text, text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.confirm_work_record(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_work_record(uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.reopen_work_record(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reopen_work_record(uuid, text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.void_work_record(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.void_work_record(uuid, text)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS permission helpers (used from policies)
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.regapro_has_any_shift_permission(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regapro_has_any_shift_permission(uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.regapro_has_any_work_record_permission(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regapro_has_any_work_record_permission(uuid)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Internal helpers / trigger functions — owner (postgres) only
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.regapro_shift_rpc_active()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_touch_updated_at()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_write_shift_audit(uuid, text, text, uuid, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_shift_request_date_guard()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_shift_request_dates_delete_guard()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_shift_request_mutation_guard()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_shift_mutation_guard()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_shift_request_integrity()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_shift_integrity()
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.regapro_work_rpc_active()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_write_work_audit(uuid, text, text, uuid, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_work_record_snapshot(public.work_records)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_append_work_record_revision(public.work_records, text, uuid, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_assert_staff_same_org(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_lock_employment_term_scope(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_employment_term_integrity()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_employment_term_mutation_guard()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_work_record_integrity()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_work_record_mutation_guard()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_work_record_revision_integrity()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.regapro_work_record_revision_mutation_guard()
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- service_role-only privilege snapshot for integration tests
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.regapro_shift_work_acl_privileges()
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
      ('public.create_or_replace_shift_request_draft(date, date, jsonb, uuid)', 'business'),
      ('public.submit_shift_request(uuid)', 'business'),
      ('public.cancel_shift_request(uuid)', 'business'),
      ('public.publish_shift(uuid)', 'business'),
      ('public.cancel_shift(uuid)', 'business'),
      ('public.create_employment_term(uuid, integer, date, date, boolean)', 'business'),
      ('public.revoke_employment_term(uuid, text)', 'business'),
      ('public.create_or_update_work_record_draft(uuid, uuid, date, time, time, smallint, integer, integer, uuid, uuid, text, text)', 'business'),
      ('public.confirm_work_record(uuid)', 'business'),
      ('public.reopen_work_record(uuid, text)', 'business'),
      ('public.void_work_record(uuid, text)', 'business'),
      ('public.regapro_has_any_shift_permission(uuid)', 'rls_helper'),
      ('public.regapro_has_any_work_record_permission(uuid)', 'rls_helper'),
      ('public.regapro_shift_rpc_active()', 'internal'),
      ('public.regapro_touch_updated_at()', 'internal'),
      ('public.regapro_write_shift_audit(uuid, text, text, uuid, uuid, uuid, jsonb)', 'internal'),
      ('public.regapro_shift_request_date_guard()', 'internal'),
      ('public.regapro_shift_request_dates_delete_guard()', 'internal'),
      ('public.regapro_shift_request_mutation_guard()', 'internal'),
      ('public.regapro_shift_mutation_guard()', 'internal'),
      ('public.regapro_shift_request_integrity()', 'internal'),
      ('public.regapro_shift_integrity()', 'internal'),
      ('public.regapro_work_rpc_active()', 'internal'),
      ('public.regapro_write_work_audit(uuid, text, text, uuid, uuid, uuid, jsonb)', 'internal'),
      ('public.regapro_work_record_snapshot(public.work_records)', 'internal'),
      ('public.regapro_append_work_record_revision(public.work_records, text, uuid, jsonb, text)', 'internal'),
      ('public.regapro_assert_staff_same_org(uuid, uuid, text)', 'internal'),
      ('public.regapro_lock_employment_term_scope(uuid, uuid)', 'internal'),
      ('public.regapro_employment_term_integrity()', 'internal'),
      ('public.regapro_employment_term_mutation_guard()', 'internal'),
      ('public.regapro_work_record_integrity()', 'internal'),
      ('public.regapro_work_record_mutation_guard()', 'internal'),
      ('public.regapro_work_record_revision_integrity()', 'internal'),
      ('public.regapro_work_record_revision_mutation_guard()', 'internal')
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

COMMENT ON FUNCTION public.regapro_shift_work_acl_privileges() IS
  'Read-only Phase 2/3 function EXECUTE matrix for ACL tests. Not a business RPC.';

REVOKE ALL ON FUNCTION public.regapro_shift_work_acl_privileges()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regapro_shift_work_acl_privileges()
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
  FROM public.regapro_shift_work_acl_privileges()
  WHERE (kind = 'business' AND (
          (grantee = 'anon' AND can_execute)
          OR (grantee IN ('authenticated', 'service_role') AND NOT can_execute)
        ))
     OR (kind = 'rls_helper' AND (
          (grantee = 'anon' AND can_execute)
          OR (grantee IN ('authenticated', 'service_role') AND NOT can_execute)
        ))
     OR (kind = 'internal' AND can_execute);

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'SHIFT_WORK_ACL: unexpected EXECUTE grants: %', v_bad;
  END IF;

  IF has_function_privilege('anon', 'public.regapro_shift_work_acl_privileges()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.regapro_shift_work_acl_privileges()', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.regapro_shift_work_acl_privileges()', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'SHIFT_WORK_ACL: privilege probe must be service_role-only';
  END IF;
END;
$$;
