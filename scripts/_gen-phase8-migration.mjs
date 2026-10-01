import fs from "node:fs";
import path from "node:path";

const out = path.resolve(
  "supabase/migrations/20261001200000_expense_sales_phase8_foundation.sql",
);

const sql = `-- Phase 8: Expense + personal sales foundation (after 20261001190000).

ALTER TABLE public.migration_identity_matches
  DROP CONSTRAINT IF EXISTS migration_identity_matches_match_method_check;
ALTER TABLE public.migration_identity_matches
  ADD CONSTRAINT migration_identity_matches_match_method_check
  CHECK (match_method IN (
    'staff_no', 'email', 'name', 'manual', 'existing_identity', 'auth_user_id'
  ));

CREATE TABLE public.expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  code text NOT NULL,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expense_categories_code_unique UNIQUE (org_id, code)
);
CREATE INDEX idx_expense_categories_org ON public.expense_categories (org_id, sort_order);

INSERT INTO public.expense_categories (org_id, code, name, sort_order)
SELECT o.id, x.code, x.name, x.ord
FROM public.organizations o
CROSS JOIN (
  VALUES ('transport', '交通費', 10),
         ('supplies', '消耗品', 20),
         ('meeting', '会議費', 30),
         ('other', 'その他', 99)
) AS x(code, name, ord)
ON CONFLICT (org_id, code) DO NOTHING;

CREATE TABLE public.expense_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  staff_id uuid NOT NULL REFERENCES public.staff(staff_id),
  status text NOT NULL CHECK (status IN ('draft', 'pending', 'approved', 'returned')),
  current_version_no integer NOT NULL DEFAULT 1 CHECK (current_version_no >= 1),
  application_type text NOT NULL CHECK (application_type IN ('advance', 'after')),
  category_id uuid NOT NULL REFERENCES public.expense_categories(id),
  amount_yen integer NOT NULL CHECK (amount_yen > 0),
  expense_date date NOT NULL,
  description text NOT NULL,
  file_object_id uuid REFERENCES public.file_objects(id),
  submitted_at timestamptz,
  submitted_by_staff_id uuid REFERENCES public.staff(staff_id),
  returned_at timestamptz,
  returned_by_staff_id uuid REFERENCES public.staff(staff_id),
  return_reason text,
  approved_at timestamptz,
  approved_by_staff_id uuid REFERENCES public.staff(staff_id),
  created_by_staff_id uuid NOT NULL REFERENCES public.staff(staff_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  migration_import_batch_id uuid REFERENCES public.migration_import_batches(id),
  migration_external_id text,
  CONSTRAINT expense_applications_migration_external UNIQUE (org_id, migration_external_id)
);
CREATE INDEX idx_expense_applications_org_status
  ON public.expense_applications (org_id, status, expense_date DESC);
CREATE INDEX idx_expense_applications_org_staff
  ON public.expense_applications (org_id, staff_id, expense_date DESC);

CREATE TABLE public.expense_application_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.expense_applications(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  version_no integer NOT NULL CHECK (version_no >= 1),
  application_type text NOT NULL CHECK (application_type IN ('advance', 'after')),
  category_id uuid NOT NULL REFERENCES public.expense_categories(id),
  amount_yen integer NOT NULL CHECK (amount_yen > 0),
  expense_date date NOT NULL,
  description text NOT NULL,
  file_object_id uuid REFERENCES public.file_objects(id),
  created_by_staff_id uuid NOT NULL REFERENCES public.staff(staff_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expense_application_versions_unique UNIQUE (application_id, version_no)
);

CREATE TABLE public.expense_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  actor_staff_id uuid REFERENCES public.staff(staff_id),
  subject_staff_id uuid REFERENCES public.staff(staff_id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_expense_events_org_created ON public.expense_events (org_id, created_at DESC);

CREATE TABLE public.personal_sales_allocation_rule_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  version integer NOT NULL CHECK (version >= 1),
  status text NOT NULL CHECK (status IN ('draft', 'approved', 'revoked')),
  effective_from date NOT NULL,
  effective_to date,
  rule_payload jsonb NOT NULL,
  created_by_staff_id uuid NOT NULL REFERENCES public.staff(staff_id),
  approved_by_staff_id uuid REFERENCES public.staff(staff_id),
  approved_at timestamptz,
  revoked_at timestamptz,
  revoked_by_staff_id uuid REFERENCES public.staff(staff_id),
  revoke_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT personal_sales_rule_version_unique UNIQUE (org_id, version),
  CONSTRAINT personal_sales_rule_range CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE TABLE public.personal_sales_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  staff_id uuid NOT NULL REFERENCES public.staff(staff_id),
  occurred_on date NOT NULL,
  title text NOT NULL,
  total_amount_yen integer NOT NULL CHECK (total_amount_yen > 0),
  status text NOT NULL CHECK (status IN ('active', 'voided', 'corrected')),
  note text,
  corrected_case_id uuid REFERENCES public.personal_sales_cases(id),
  created_by_staff_id uuid NOT NULL REFERENCES public.staff(staff_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  migration_import_batch_id uuid REFERENCES public.migration_import_batches(id),
  migration_external_id text,
  CONSTRAINT personal_sales_cases_migration_external UNIQUE (org_id, migration_external_id)
);
CREATE INDEX idx_personal_sales_cases_org ON public.personal_sales_cases (org_id, occurred_on DESC);
CREATE INDEX idx_personal_sales_cases_staff ON public.personal_sales_cases (org_id, staff_id, occurred_on DESC);

CREATE TABLE public.personal_sales_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.personal_sales_cases(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  staff_id uuid NOT NULL REFERENCES public.staff(staff_id),
  share_rate_bps integer NOT NULL CHECK (share_rate_bps >= 0 AND share_rate_bps <= 10000),
  amount_yen integer NOT NULL CHECK (amount_yen >= 0),
  allocation_rule_version_id uuid REFERENCES public.personal_sales_allocation_rule_versions(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_personal_sales_alloc_case ON public.personal_sales_allocations (case_id);

CREATE TABLE public.personal_sales_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  actor_staff_id uuid REFERENCES public.staff(staff_id),
  subject_staff_id uuid REFERENCES public.staff(staff_id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_personal_sales_events_org ON public.personal_sales_events (org_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.regapro_expense_rpc_active()
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT current_setting('regapro.expense_rpc', true) = '1';
$$;

CREATE OR REPLACE FUNCTION public.regapro_personal_sales_rpc_active()
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT current_setting('regapro.personal_sales_rpc', true) = '1';
$$;

CREATE OR REPLACE FUNCTION public.regapro_expense_service_role()
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(auth.jwt() ->> 'role', '') = 'service_role';
$$;

CREATE OR REPLACE FUNCTION public.regapro_personal_sales_service_role()
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(auth.jwt() ->> 'role', '') = 'service_role';
$$;

CREATE OR REPLACE FUNCTION public.regapro_has_any_expense_permission(p_org_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    public.regapro_staff_has_permission(p_org_id, 'expense.submit')
    OR public.regapro_staff_has_permission(p_org_id, 'expense.view_own')
    OR public.regapro_staff_has_permission(p_org_id, 'expense.manage');
$$;

CREATE OR REPLACE FUNCTION public.regapro_has_any_sales_permission(p_org_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    public.regapro_staff_has_permission(p_org_id, 'sales.view_own')
    OR public.regapro_staff_has_permission(p_org_id, 'sales.manage');
$$;

CREATE OR REPLACE FUNCTION public.regapro_write_expense_event(
  p_org_id uuid, p_action text, p_entity_type text, p_entity_id uuid,
  p_actor_staff_id uuid, p_subject_staff_id uuid, p_metadata jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.expense_events (
    org_id, action, entity_type, entity_id, actor_staff_id, subject_staff_id, metadata
  ) VALUES (
    p_org_id, p_action, p_entity_type, p_entity_id, p_actor_staff_id, p_subject_staff_id,
    COALESCE(p_metadata, '{}'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.regapro_write_personal_sales_event(
  p_org_id uuid, p_action text, p_entity_type text, p_entity_id uuid,
  p_actor_staff_id uuid, p_subject_staff_id uuid, p_metadata jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.personal_sales_events (
    org_id, action, entity_type, entity_id, actor_staff_id, subject_staff_id, metadata
  ) VALUES (
    p_org_id, p_action, p_entity_type, p_entity_id, p_actor_staff_id, p_subject_staff_id,
    COALESCE(p_metadata, '{}'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.regapro_touch_expense_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;
CREATE TRIGGER trg_expense_applications_updated_at
  BEFORE UPDATE ON public.expense_applications
  FOR EACH ROW EXECUTE FUNCTION public.regapro_touch_expense_updated_at();

CREATE OR REPLACE FUNCTION public.regapro_touch_personal_sales_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;
CREATE TRIGGER trg_personal_sales_cases_updated_at
  BEFORE UPDATE ON public.personal_sales_cases
  FOR EACH ROW EXECUTE FUNCTION public.regapro_touch_personal_sales_updated_at();

CREATE OR REPLACE FUNCTION public.regapro_expense_application_mutation_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF public.regapro_expense_rpc_active() OR public.regapro_expense_service_role() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'EXPENSE_FORBIDDEN: mutate expense_applications via RPC only' USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER trg_expense_applications_mutation_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.expense_applications
  FOR EACH ROW EXECUTE FUNCTION public.regapro_expense_application_mutation_guard();

CREATE OR REPLACE FUNCTION public.regapro_expense_category_mutation_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF public.regapro_expense_rpc_active() OR public.regapro_expense_service_role() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'EXPENSE_FORBIDDEN: mutate expense_categories via RPC only' USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER trg_expense_categories_mutation_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.expense_categories
  FOR EACH ROW EXECUTE FUNCTION public.regapro_expense_category_mutation_guard();

CREATE OR REPLACE FUNCTION public.regapro_personal_sales_case_mutation_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF public.regapro_personal_sales_rpc_active() OR public.regapro_personal_sales_service_role() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'SALES_FORBIDDEN: mutate personal_sales_cases via RPC only' USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER trg_personal_sales_cases_mutation_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.personal_sales_cases
  FOR EACH ROW EXECUTE FUNCTION public.regapro_personal_sales_case_mutation_guard();

CREATE OR REPLACE FUNCTION public.regapro_personal_sales_allocation_mutation_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF public.regapro_personal_sales_rpc_active() OR public.regapro_personal_sales_service_role() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'SALES_FORBIDDEN: mutate personal_sales_allocations via RPC only' USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER trg_personal_sales_allocations_mutation_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.personal_sales_allocations
  FOR EACH ROW EXECUTE FUNCTION public.regapro_personal_sales_allocation_mutation_guard();

CREATE OR REPLACE FUNCTION public.regapro_personal_sales_rule_mutation_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF public.regapro_personal_sales_rpc_active() OR public.regapro_personal_sales_service_role() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'SALES_FORBIDDEN: mutate personal_sales_allocation_rule_versions via RPC only' USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER trg_personal_sales_rules_mutation_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.personal_sales_allocation_rule_versions
  FOR EACH ROW EXECUTE FUNCTION public.regapro_personal_sales_rule_mutation_guard();

CREATE OR REPLACE FUNCTION public.regapro_can_read_expense_application(p_application_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.expense_applications ea
    WHERE ea.id = p_application_id
      AND public.regapro_staff_belongs_to_org(ea.org_id)
      AND (
        ea.staff_id = public.regapro_current_staff_id()
        OR public.regapro_staff_has_permission(ea.org_id, 'expense.manage')
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.regapro_can_access_storage_object(p_bucket text, p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.file_objects fo
    WHERE fo.bucket = p_bucket AND fo.path = p_name AND fo.deleted_at IS NULL
      AND public.regapro_can_access_labeled_row(
        fo.org_id, fo.confidentiality_level, fo.visibility, fo.created_by,
        NULL, NULL, fo.origin_thread_id
      )
  )
  OR (
    p_bucket = 'expense-receipts'
    AND EXISTS (
      SELECT 1 FROM public.file_objects fo
      JOIN public.expense_applications ea ON ea.file_object_id = fo.id
      WHERE fo.bucket = p_bucket AND fo.path = p_name AND fo.deleted_at IS NULL
        AND public.regapro_can_read_expense_application(ea.id)
    )
  );
$$;

INSERT INTO storage.buckets (id, name, public) VALUES ('expense-receipts', 'expense-receipts', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS storage_org_select ON storage.objects;
CREATE POLICY storage_org_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id IN (
      'knowledge-files', 'chat-attachments', 'artifacts', 'research-snapshots',
      'knowledge-sources', 'expense-receipts'
    )
    AND public.regapro_can_access_storage_object(bucket_id, name)
  );

DROP POLICY IF EXISTS storage_org_insert ON storage.objects;
CREATE POLICY storage_org_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id IN (
      'knowledge-files', 'chat-attachments', 'artifacts', 'research-snapshots',
      'knowledge-sources', 'expense-receipts'
    )
    AND name LIKE 'org/%'
    AND public.regapro_is_org_member((split_part(name, '/', 2))::uuid)
  );

DROP POLICY IF EXISTS storage_org_update ON storage.objects;
CREATE POLICY storage_org_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id IN (
      'knowledge-files', 'chat-attachments', 'artifacts', 'research-snapshots',
      'knowledge-sources', 'expense-receipts'
    )
    AND public.regapro_can_access_storage_object(bucket_id, name)
  )
  WITH CHECK (
    bucket_id IN (
      'knowledge-files', 'chat-attachments', 'artifacts', 'research-snapshots',
      'knowledge-sources', 'expense-receipts'
    )
    AND public.regapro_can_access_storage_object(bucket_id, name)
  );

DROP POLICY IF EXISTS storage_org_delete ON storage.objects;
CREATE POLICY storage_org_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id IN (
      'knowledge-files', 'chat-attachments', 'artifacts', 'research-snapshots',
      'knowledge-sources', 'expense-receipts'
    )
    AND public.regapro_can_access_storage_object(bucket_id, name)
  );

`;

const tail = fs.readFileSync(new URL("./_phase8-rpc-tail.sql", import.meta.url), "utf8");
fs.writeFileSync(out, sql + tail);
console.log("wrote", fs.statSync(out).size);
