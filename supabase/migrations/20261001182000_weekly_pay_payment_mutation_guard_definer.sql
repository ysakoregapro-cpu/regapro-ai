-- Payment mutation guard must be SECURITY DEFINER so service_role fixture/admin
-- cleanup can call internal helpers that are not EXECUTE-granted to callers.

CREATE OR REPLACE FUNCTION public.regapro_weekly_pay_payment_mutation_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.regapro_weekly_pay_rpc_active() OR public.regapro_weekly_pay_service_role() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'WEEKLY_PAY_FORBIDDEN: payment tables are RPC-only' USING ERRCODE = '42501';
END;
$$;
