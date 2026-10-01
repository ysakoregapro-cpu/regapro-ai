-- Phase 3.6 Migration B: pin mutable search_path on two leftover functions.
-- Function bodies are unchanged.
--
-- Identity args for regapro_level_to_int are "p_level text" (named parameter
-- from CREATE). Use regprocedure casts so ALTER / assertions resolve by type.

ALTER FUNCTION public.regapro_current_user_id()
  SET search_path = public;

ALTER FUNCTION public.regapro_level_to_int(text)
  SET search_path = public;

DO $$
DECLARE
  v_user_id text[];
  v_level text[];
BEGIN
  SELECT p.proconfig INTO v_user_id
  FROM pg_proc p
  WHERE p.oid = 'public.regapro_current_user_id()'::regprocedure;

  SELECT p.proconfig INTO v_level
  FROM pg_proc p
  WHERE p.oid = 'public.regapro_level_to_int(text)'::regprocedure;

  IF v_user_id IS NULL OR NOT ('search_path=public' = ANY (v_user_id)) THEN
    RAISE EXCEPTION 'SEARCH_PATH: regapro_current_user_id() must pin search_path=public (proconfig=%)', v_user_id;
  END IF;

  IF v_level IS NULL OR NOT ('search_path=public' = ANY (v_level)) THEN
    RAISE EXCEPTION 'SEARCH_PATH: regapro_level_to_int(text) must pin search_path=public (proconfig=%)', v_level;
  END IF;
END;
$$;
