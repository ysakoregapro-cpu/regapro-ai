ALTER TABLE public.research_runs
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'http',
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS extras jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.research_runs
  DROP CONSTRAINT IF EXISTS research_runs_provider_check;

ALTER TABLE public.research_runs
  ADD CONSTRAINT research_runs_provider_check
  CHECK (provider IN ('demo', 'searxng', 'http', 'web-intelligence'));;
