-- Phase 3.6 Migration C: stop default privileges from re-granting
-- anon / authenticated EXECUTE and table ALL on future public objects.
--
-- PostgreSQL hardwires EXECUTE FOR PUBLIC on new functions. Per docs
-- (ALTER DEFAULT PRIVILEGES), that hardwired grant can only be removed
-- with a *global* (no IN SCHEMA) REVOKE. Schema-scoped
-- `REVOKE ... FROM PUBLIC` is a no-op unless it undoes a prior schema GRANT.
-- See https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html
--
-- Proven on disposable Postgres (PGlite):
--   1) FOR ROLE postgres IN SCHEMA public REVOKE ... FROM PUBLIC alone
--      leaves hardwired PUBLIC EXECUTE → anon/authenticated/service_role
--      still can EXECUTE new functions.
--   2) Schema REVOKE of anon/authenticated/service_role + global
--      REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC → public new functions are
--      owner-only; storage schema ADP role grants remain additive.
--
-- Cross-schema impact of the global PUBLIC revoke (FOR ROLE postgres):
--   - Schemas that already GRANT EXECUTE to anon/authenticated/service_role
--     via schema ADP (e.g. storage) keep those role grants.
--   - Schemas with no function ADP (e.g. future custom schemas, extensions
--     if created by postgres) become owner-only for new functions — intentional.
--   - FOR ROLE supabase_admin defaults are unchanged (not migration apply role).
--
-- Does not create temporary public objects. Asserts pg_default_acl only.
--
-- Future TABLES / SEQUENCES in public: revoke anon / authenticated defaults.
-- service_role table/sequence defaults are kept — many existing CREATE TABLE
-- migrations never GRANT service_role explicitly and fixtures / backfill /
-- RLS harness insert via service_role. Guessing a revoke would break them.

-- Remove Supabase schema-scoped role grants on future public functions.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;

-- Remove hardwired PUBLIC EXECUTE for all future functions created by postgres.
-- Must be global; schema-scoped REVOKE FROM PUBLIC cannot undo the hardwired grant.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_func_global aclitem[];
  v_func_public aclitem[];
  v_table aclitem[];
  v_seq aclitem[];
  v_item text;
  v_storage_func aclitem[];
BEGIN
  SELECT d.defaclacl INTO v_func_global
  FROM pg_default_acl d
  JOIN pg_roles r ON r.oid = d.defaclrole
  WHERE d.defaclnamespace = 0
    AND r.rolname = 'postgres'
    AND d.defaclobjtype = 'f';

  IF v_func_global IS NULL THEN
    RAISE EXCEPTION
      'DEFAULT_ACL: global function default for postgres missing after REVOKE FROM PUBLIC';
  END IF;

  FOREACH v_item IN ARRAY v_func_global LOOP
    -- PUBLIC appears as empty grantee: =X/postgres
    IF v_item LIKE '=%X/%' OR v_item LIKE '=%/%' THEN
      RAISE EXCEPTION 'DEFAULT_ACL: global functions still default EXECUTE to PUBLIC (%)', v_item;
    END IF;
    IF v_item LIKE 'anon=%X%' OR v_item LIKE 'authenticated=%X%' OR v_item LIKE 'service_role=%X%' THEN
      RAISE EXCEPTION 'DEFAULT_ACL: global functions still default EXECUTE to %', v_item;
    END IF;
  END LOOP;

  SELECT d.defaclacl INTO v_func_public
  FROM pg_default_acl d
  JOIN pg_namespace n ON n.oid = d.defaclnamespace
  JOIN pg_roles r ON r.oid = d.defaclrole
  WHERE n.nspname = 'public'
    AND r.rolname = 'postgres'
    AND d.defaclobjtype = 'f';

  FOREACH v_item IN ARRAY COALESCE(v_func_public, '{}'::aclitem[]) LOOP
    IF v_item LIKE 'anon=%X%' OR v_item LIKE 'authenticated=%X%' OR v_item LIKE 'service_role=%X%' THEN
      RAISE EXCEPTION 'DEFAULT_ACL: public schema functions still default EXECUTE to %', v_item;
    END IF;
  END LOOP;

  SELECT d.defaclacl INTO v_table
  FROM pg_default_acl d
  JOIN pg_namespace n ON n.oid = d.defaclnamespace
  JOIN pg_roles r ON r.oid = d.defaclrole
  WHERE n.nspname = 'public'
    AND r.rolname = 'postgres'
    AND d.defaclobjtype = 'r';

  SELECT d.defaclacl INTO v_seq
  FROM pg_default_acl d
  JOIN pg_namespace n ON n.oid = d.defaclnamespace
  JOIN pg_roles r ON r.oid = d.defaclrole
  WHERE n.nspname = 'public'
    AND r.rolname = 'postgres'
    AND d.defaclobjtype = 'S';

  FOREACH v_item IN ARRAY COALESCE(v_table, '{}'::aclitem[]) LOOP
    IF v_item LIKE 'anon=%' OR v_item LIKE 'authenticated=%' THEN
      RAISE EXCEPTION 'DEFAULT_ACL: future tables still default grants to %', v_item;
    END IF;
  END LOOP;

  FOREACH v_item IN ARRAY COALESCE(v_seq, '{}'::aclitem[]) LOOP
    IF v_item LIKE 'anon=%' OR v_item LIKE 'authenticated=%' THEN
      RAISE EXCEPTION 'DEFAULT_ACL: future sequences still default grants to %', v_item;
    END IF;
  END LOOP;

  -- Non-public schema ADP must remain (storage keeps API role EXECUTE defaults).
  SELECT d.defaclacl INTO v_storage_func
  FROM pg_default_acl d
  JOIN pg_namespace n ON n.oid = d.defaclnamespace
  JOIN pg_roles r ON r.oid = d.defaclrole
  WHERE n.nspname = 'storage'
    AND r.rolname = 'postgres'
    AND d.defaclobjtype = 'f';

  IF v_storage_func IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM unnest(v_storage_func) AS a(item)
       WHERE a.item::text LIKE 'anon=%X%'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM unnest(v_storage_func) AS a(item)
       WHERE a.item::text LIKE 'authenticated=%X%'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM unnest(v_storage_func) AS a(item)
       WHERE a.item::text LIKE 'service_role=%X%'
     )
  THEN
    RAISE EXCEPTION
      'DEFAULT_ACL: storage schema function defaults for API roles must remain unchanged';
  END IF;
END;
$$;
