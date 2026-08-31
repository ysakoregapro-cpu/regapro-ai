-- Integrated App Foundation v1 — legacy import scaffolding.
--
-- No production data is migrated here and no legacy database is touched. These
-- tables exist so a future expense / sales / weekly-pay import can be run in
-- reviewable batches, keep its raw payloads, record how each legacy person was
-- matched to a staff_id, and be re-run or rolled back per batch.
--
-- Every row is administrator-only: raw payloads contain legacy personal data.
--
-- Do not apply to linked production without review.

CREATE TABLE public.migration_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  source_system text NOT NULL,
  -- What the batch carries: 'staff', 'expense', 'sales', 'weekly_pay', ...
  entity_kind text NOT NULL,
  label text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'validating', 'ready', 'applied', 'failed', 'rolled_back')),
  -- Dry runs are the default; applying is an explicit, audited step.
  dry_run boolean NOT NULL DEFAULT true,
  total_records integer NOT NULL DEFAULT 0,
  matched_records integer NOT NULL DEFAULT 0,
  failed_records integer NOT NULL DEFAULT 0,
  created_by_staff_id uuid REFERENCES public.staff(staff_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  notes text
);
CREATE INDEX idx_migration_batches_org ON public.migration_import_batches(org_id, created_at DESC);

CREATE TABLE public.migration_source_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.migration_import_batches(id) ON DELETE CASCADE,
  -- Primary key as it exists in the legacy system.
  external_record_id text NOT NULL,
  external_user_id text,
  payload jsonb NOT NULL,
  -- Detects re-import of an unchanged row.
  content_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'matched', 'unmatched', 'imported', 'skipped', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, external_record_id)
);
CREATE INDEX idx_migration_source_records_batch
  ON public.migration_source_records(batch_id, status);

CREATE TABLE public.migration_identity_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.migration_import_batches(id) ON DELETE CASCADE,
  source_system text NOT NULL,
  external_user_id text NOT NULL,
  -- NULL until a human or rule resolves the person.
  staff_id uuid REFERENCES public.staff(staff_id),
  match_method text NOT NULL
    CHECK (match_method IN ('staff_no', 'email', 'name', 'manual', 'existing_identity')),
  confidence numeric(4, 3),
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'confirmed', 'rejected')),
  confirmed_by_staff_id uuid REFERENCES public.staff(staff_id),
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, source_system, external_user_id)
);
CREATE INDEX idx_migration_identity_matches_staff
  ON public.migration_identity_matches(staff_id);

COMMENT ON TABLE public.migration_identity_matches IS
  'Legacy person -> staff_id mapping proposals. Confirmed rows become staff_identities; nothing is auto-linked.';

CREATE TABLE public.migration_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.migration_import_batches(id) ON DELETE CASCADE,
  source_record_id uuid REFERENCES public.migration_source_records(id) ON DELETE CASCADE,
  error_code text NOT NULL,
  -- Operator-facing detail. Never store credentials or full legacy dumps.
  message text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_migration_errors_batch ON public.migration_errors(batch_id, created_at DESC);

-- Explicit grants: this project does not rely on default privileges.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.migration_import_batches TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.migration_source_records TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.migration_identity_matches TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.migration_errors TO authenticated;

GRANT ALL ON TABLE public.migration_import_batches TO service_role;
GRANT ALL ON TABLE public.migration_source_records TO service_role;
GRANT ALL ON TABLE public.migration_identity_matches TO service_role;
GRANT ALL ON TABLE public.migration_errors TO service_role;

ALTER TABLE public.migration_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.migration_source_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.migration_identity_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.migration_errors ENABLE ROW LEVEL SECURITY;

CREATE POLICY migration_batches_manage ON public.migration_import_batches
  FOR ALL USING (public.regapro_can_manage_staff(org_id))
  WITH CHECK (public.regapro_can_manage_staff(org_id));

CREATE POLICY migration_source_records_manage ON public.migration_source_records
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.migration_import_batches b
      WHERE b.id = migration_source_records.batch_id
        AND public.regapro_can_manage_staff(b.org_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.migration_import_batches b
      WHERE b.id = migration_source_records.batch_id
        AND public.regapro_can_manage_staff(b.org_id)
    )
  );

CREATE POLICY migration_identity_matches_manage ON public.migration_identity_matches
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.migration_import_batches b
      WHERE b.id = migration_identity_matches.batch_id
        AND public.regapro_can_manage_staff(b.org_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.migration_import_batches b
      WHERE b.id = migration_identity_matches.batch_id
        AND public.regapro_can_manage_staff(b.org_id)
    )
  );

CREATE POLICY migration_errors_manage ON public.migration_errors
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.migration_import_batches b
      WHERE b.id = migration_errors.batch_id
        AND public.regapro_can_manage_staff(b.org_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.migration_import_batches b
      WHERE b.id = migration_errors.batch_id
        AND public.regapro_can_manage_staff(b.org_id)
    )
  );
