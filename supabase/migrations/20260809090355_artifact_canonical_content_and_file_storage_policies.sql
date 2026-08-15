-- Artifact / File durable storage
-- - Canonical markdown/text lives in artifact_versions.canonical_content (DB)
-- - storage_path remains for optional rendered/export binaries (pdf/docx/…) — never pending://
-- - file_objects gains original_filename; soft-delete UPDATE for upload compensation
-- - Write policies for artifact versions / artifact update (JWT path, no service_role)

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.artifact_versions
  ADD COLUMN IF NOT EXISTS canonical_content text;

COMMENT ON COLUMN public.artifact_versions.canonical_content IS
  'Canonical text body (usually markdown). Durable source of truth for preview and revision. Separate from rendered/export binaries.';

COMMENT ON COLUMN public.artifact_versions.storage_path IS
  'Optional Storage object path for rendered/export binaries (pdf/docx/xlsx/pptx). NULL when only canonical_content exists. Must not use pending:// placeholders.';

ALTER TABLE public.file_objects
  ADD COLUMN IF NOT EXISTS original_filename text;

COMMENT ON COLUMN public.file_objects.original_filename IS
  'User-visible original filename. Storage path may sanitize or namespace objects.';

-- Drop legacy placeholder paths if any were written during metadata-only phase
UPDATE public.artifact_versions
SET storage_path = NULL
WHERE storage_path LIKE 'pending://%';

-- ---------------------------------------------------------------------------
-- artifacts / artifact_versions write policies
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS artifacts_update ON public.artifacts;
CREATE POLICY artifacts_update ON public.artifacts
  FOR UPDATE TO authenticated
  USING (
    deleted_at IS NULL
    AND public.regapro_can_access_labeled_row(
      org_id, confidentiality_level, visibility, created_by, NULL, project_id, origin_thread_id
    )
    AND (
      created_by = auth.uid()
      OR public.regapro_has_permission(org_id, 'artifact:generate')
    )
  )
  WITH CHECK (
    public.regapro_has_permission(org_id, 'artifact:generate')
    AND public.regapro_can_assign_confidentiality_level(org_id, confidentiality_level)
    AND (
      origin_thread_id IS NULL
      OR public.regapro_can_access_thread(origin_thread_id)
    )
  );

DROP POLICY IF EXISTS artifact_versions_insert ON public.artifact_versions;
CREATE POLICY artifact_versions_insert ON public.artifact_versions
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.artifacts a
      WHERE a.id = artifact_id
        AND a.deleted_at IS NULL
        AND public.regapro_has_permission(a.org_id, 'artifact:generate')
        AND public.regapro_can_access_labeled_row(
          a.org_id, a.confidentiality_level, a.visibility,
          a.created_by, NULL, a.project_id, a.origin_thread_id
        )
        AND (
          a.created_by = auth.uid()
          OR public.regapro_can_access_thread(a.origin_thread_id)
        )
    )
  );

-- ---------------------------------------------------------------------------
-- file_objects soft-delete / checksum update (upload compensation)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS file_objects_update ON public.file_objects;
CREATE POLICY file_objects_update ON public.file_objects
  FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    AND public.regapro_is_org_member(org_id)
  )
  WITH CHECK (
    created_by = auth.uid()
    AND public.regapro_is_org_member(org_id)
  );

-- Allow deleting an orphaned Storage object when metadata insert failed
-- (no active file_objects row). Does not widen read access.
DROP POLICY IF EXISTS storage_org_delete_orphan ON storage.objects;
CREATE POLICY storage_org_delete_orphan ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id IN ('knowledge-files', 'chat-attachments', 'artifacts', 'research-snapshots')
    AND name LIKE 'org/%'
    AND owner = auth.uid()
    AND NOT EXISTS (
      SELECT 1
      FROM public.file_objects fo
      WHERE fo.bucket = bucket_id
        AND fo.path = name
        AND fo.deleted_at IS NULL
    )
  );
