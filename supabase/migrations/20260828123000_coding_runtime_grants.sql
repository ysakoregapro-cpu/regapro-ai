-- Coding Agent Runtime: explicit table privileges for authenticated / service_role.
-- Follow-up to 20260818120000_coding_agent_runtime.sql, which defined RLS but no GRANTs.
-- This project does not rely on default privileges: without GRANT, RLS never runs.
--
-- Grants mirror existing policies only (minimal privilege). No RLS policy changes.
-- coding_commands and coding_audit_events have SELECT-only policies for authenticated;
-- INSERT/UPDATE for those tables remain service_role or future policy work.

GRANT SELECT, INSERT, UPDATE ON TABLE public.coding_devices TO authenticated;
GRANT SELECT, INSERT ON TABLE public.coding_pairing_challenges TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.coding_workspaces TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.coding_runs TO authenticated;
GRANT SELECT ON TABLE public.coding_commands TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.coding_approvals TO authenticated;
GRANT SELECT ON TABLE public.coding_audit_events TO authenticated;

GRANT ALL ON TABLE public.coding_devices TO service_role;
GRANT ALL ON TABLE public.coding_pairing_challenges TO service_role;
GRANT ALL ON TABLE public.coding_workspaces TO service_role;
GRANT ALL ON TABLE public.coding_runs TO service_role;
GRANT ALL ON TABLE public.coding_commands TO service_role;
GRANT ALL ON TABLE public.coding_approvals TO service_role;
GRANT ALL ON TABLE public.coding_audit_events TO service_role;
