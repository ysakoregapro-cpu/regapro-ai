-- Phase 8.1: fix expense receipt helper EXECUTE + personal sales RLS recursion.
-- Forward-only. Does not edit 20261001200000.

REVOKE ALL ON FUNCTION public.regapro_can_read_expense_application(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.regapro_can_read_expense_application(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.regapro_can_read_personal_sales_case(p_case_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.personal_sales_cases c
    WHERE c.id = p_case_id
      AND public.regapro_staff_belongs_to_org(c.org_id)
      AND (
        public.regapro_staff_has_permission(c.org_id, 'sales.manage')
        OR (
          c.staff_id IS NOT NULL
          AND c.staff_id = public.regapro_current_staff_id()
        )
        OR EXISTS (
          SELECT 1
          FROM public.personal_sales_allocations a
          WHERE a.case_id = c.id
            AND a.staff_id = public.regapro_current_staff_id()
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.regapro_can_read_personal_sales_case(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.regapro_can_read_personal_sales_case(uuid)
  TO authenticated, service_role;

DROP POLICY IF EXISTS personal_sales_cases_select ON public.personal_sales_cases;
CREATE POLICY personal_sales_cases_select ON public.personal_sales_cases
  FOR SELECT TO authenticated
  USING (public.regapro_can_read_personal_sales_case(id));

DROP POLICY IF EXISTS personal_sales_allocations_select ON public.personal_sales_allocations;
CREATE POLICY personal_sales_allocations_select ON public.personal_sales_allocations
  FOR SELECT TO authenticated
  USING (public.regapro_can_read_personal_sales_case(case_id));
