-- Persist live research provider/results on research_runs.
-- Child tables remain for future normalized writes; extras is the durable payload
-- so list/get do not fall back to demo defaults.

ALTER TABLE public.research_runs
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'http',
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS extras jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.research_runs
  DROP CONSTRAINT IF EXISTS research_runs_provider_check;

ALTER TABLE public.research_runs
  ADD CONSTRAINT research_runs_provider_check
  CHECK (provider IN ('demo', 'searxng', 'http', 'web-intelligence'));

COMMENT ON COLUMN public.research_runs.provider IS
  'web-intelligence | http | searxng | demo. demo only when REGAPRO_DATA_MODE=dev-sample.';
COMMENT ON COLUMN public.research_runs.is_demo IS
  'true only for explicit sample research. Live supabase mode always false.';
COMMENT ON COLUMN public.research_runs.extras IS
  'queries, sources, findings, citations, processingMetadata. No secrets.';
