-- Staff number allocation — org-scoped atomic sequence.
--
-- Format: RP-000001, RP-000002, … (organization-wide, immutable, never reused).
-- Domain FKs use staff_id (uuid); staff_no is display-only.
-- Legacy employee numbers belong in staff_identities.metadata, not here.
--
-- Forward-only. Do not apply to linked production without review.

CREATE TABLE public.staff_no_counters (
  org_id uuid PRIMARY KEY REFERENCES public.organizations(id),
  last_value bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.staff_no_counters IS
  'Atomic org-scoped counter for staff_no (RP-NNNNNN). Never decremented; left staff retain numbers.';

COMMENT ON COLUMN public.staff_no_counters.last_value IS
  'Last allocated sequence value for this org. Next staff_no uses last_value + 1.';

-- Atomically allocate the next staff_no for an organization.
-- Concurrent callers receive distinct numbers via INSERT … ON CONFLICT DO UPDATE.
CREATE OR REPLACE FUNCTION public.regapro_next_staff_no(p_org_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next bigint;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'regapro_next_staff_no: org_id is required';
  END IF;

  INSERT INTO public.staff_no_counters (org_id, last_value)
  VALUES (p_org_id, 1)
  ON CONFLICT (org_id) DO UPDATE
    SET last_value = staff_no_counters.last_value + 1,
        updated_at = now()
  RETURNING last_value INTO v_next;

  RETURN 'RP-' || lpad(v_next::text, 6, '0');
END;
$$;

COMMENT ON FUNCTION public.regapro_next_staff_no(uuid) IS
  'Returns the next org-scoped staff_no (RP-NNNNNN). Maintenance/backfill only — not for authenticated app callers.';

REVOKE ALL ON FUNCTION public.regapro_next_staff_no(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.regapro_next_staff_no(uuid) TO service_role;

REVOKE ALL ON TABLE public.staff_no_counters FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON TABLE public.staff_no_counters TO service_role;

ALTER TABLE public.staff_no_counters ENABLE ROW LEVEL SECURITY;

-- No policies: only service_role (maintenance) may touch counters.
