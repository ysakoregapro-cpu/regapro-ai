-- Phase 8: Expense + personal sales foundation (after 20261001190000).

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
  after_reason text,
  legacy_receipt_path text,
  legacy_receipt_migrated boolean NOT NULL DEFAULT false,
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
  deleted_at timestamptz,
  deleted_by_staff_id uuid REFERENCES public.staff(staff_id),
  migration_import_batch_id uuid REFERENCES public.migration_import_batches(id),
  migration_external_id text,
  migration_content_hash text,
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
  -- Primary related person when known; unmatched people stay out of personal views via NULL staff + no allocations.
  staff_id uuid REFERENCES public.staff(staff_id),
  occurred_on date NOT NULL,
  title text NOT NULL,
  -- Invoice/sales amount snapshot (not profit, not payroll, not weekly-pay).
  total_amount_yen integer NOT NULL CHECK (total_amount_yen >= 0),
  case_profit_incl_yen integer CHECK (case_profit_incl_yen IS NULL OR case_profit_incl_yen >= 0),
  status text NOT NULL CHECK (status IN ('active', 'voided', 'corrected')),
  note text,
  source_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  corrected_case_id uuid REFERENCES public.personal_sales_cases(id),
  created_by_staff_id uuid NOT NULL REFERENCES public.staff(staff_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  migration_import_batch_id uuid REFERENCES public.migration_import_batches(id),
  migration_external_id text,
  migration_content_hash text,
  CONSTRAINT personal_sales_cases_migration_external UNIQUE (org_id, migration_external_id)
);
CREATE INDEX idx_personal_sales_cases_org ON public.personal_sales_cases (org_id, occurred_on DESC);
CREATE INDEX idx_personal_sales_cases_staff ON public.personal_sales_cases (org_id, staff_id, occurred_on DESC);

CREATE TABLE public.personal_sales_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.personal_sales_cases(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  staff_id uuid NOT NULL REFERENCES public.staff(staff_id),
  -- Historical snapshot only. Future rules live in personal_sales_allocation_rule_versions.
  allocation_type text,
  share_rate_bps integer NOT NULL CHECK (share_rate_bps >= 0 AND share_rate_bps <= 10000),
  amount_yen integer NOT NULL CHECK (amount_yen >= 0),
  allocated_profit_incl_yen integer CHECK (
    allocated_profit_incl_yen IS NULL OR allocated_profit_incl_yen >= 0
  ),
  allocation_rule_version_id uuid REFERENCES public.personal_sales_allocation_rule_versions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  migration_external_id text,
  CONSTRAINT personal_sales_allocations_migration_external UNIQUE (org_id, migration_external_id)
);
CREATE INDEX idx_personal_sales_alloc_case ON public.personal_sales_allocations (case_id);
CREATE INDEX idx_personal_sales_alloc_staff ON public.personal_sales_allocations (org_id, staff_id);

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


CREATE OR REPLACE FUNCTION public.regapro_expense_append_version(
  p_app public.expense_applications,
  p_actor uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.expense_application_versions (
    application_id, org_id, version_no, application_type, category_id,
    amount_yen, expense_date, description, file_object_id, created_by_staff_id
  ) VALUES (
    p_app.id, p_app.org_id, p_app.current_version_no, p_app.application_type, p_app.category_id,
    p_app.amount_yen, p_app.expense_date, p_app.description, p_app.file_object_id, p_actor
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_expense_application_draft(
  p_application_id uuid,
  p_staff_id uuid,
  p_application_type text,
  p_category_id uuid,
  p_amount_yen integer,
  p_expense_date date,
  p_description text
) RETURNS public.expense_applications
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_org uuid;
  v_target uuid;
  v_app public.expense_applications;
  v_next_version integer;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'EXPENSE_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('regapro.expense_rpc', '1', true);
  SELECT s.org_id INTO v_org FROM public.staff s
  WHERE s.staff_id = v_actor AND s.status = 'active';
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'EXPENSE_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  v_target := COALESCE(p_staff_id, v_actor);
  IF v_target <> v_actor AND NOT public.regapro_staff_has_permission(v_org, 'expense.manage') THEN
    RAISE EXCEPTION 'EXPENSE_FORBIDDEN: cannot draft for another staff' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    public.regapro_staff_has_permission(v_org, 'expense.submit')
    OR public.regapro_staff_has_permission(v_org, 'expense.manage')
  ) THEN
    RAISE EXCEPTION 'EXPENSE_FORBIDDEN: expense.submit required' USING ERRCODE = '42501';
  END IF;
  IF p_amount_yen IS NULL OR p_amount_yen <= 0 THEN
    RAISE EXCEPTION 'EXPENSE_INVALID_AMOUNT: amount must be positive';
  END IF;
  IF p_application_type NOT IN ('advance', 'after') THEN
    RAISE EXCEPTION 'EXPENSE_VALIDATION: invalid application_type';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.expense_categories c
    WHERE c.id = p_category_id AND c.org_id = v_org AND c.active
  ) THEN
    RAISE EXCEPTION 'EXPENSE_NOT_FOUND: category';
  END IF;

  IF p_application_id IS NULL THEN
    INSERT INTO public.expense_applications (
      org_id, staff_id, status, current_version_no, application_type, category_id,
      amount_yen, expense_date, description, created_by_staff_id
    ) VALUES (
      v_org, v_target, 'draft', 1, p_application_type, p_category_id,
      p_amount_yen, p_expense_date, trim(p_description), v_actor
    ) RETURNING * INTO v_app;
    PERFORM public.regapro_expense_append_version(v_app, v_actor);
  ELSE
    SELECT * INTO v_app FROM public.expense_applications WHERE id = p_application_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'EXPENSE_NOT_FOUND: expense application'; END IF;
    IF v_app.org_id <> v_org THEN
      RAISE EXCEPTION 'EXPENSE_FORBIDDEN: cross-org denied' USING ERRCODE = '42501';
    END IF;
    IF v_app.staff_id <> v_target THEN
      RAISE EXCEPTION 'EXPENSE_FORBIDDEN: staff mismatch' USING ERRCODE = '42501';
    END IF;
    IF v_app.status NOT IN ('draft', 'returned') THEN
      RAISE EXCEPTION 'EXPENSE_INVALID_TRANSITION: cannot edit from %', v_app.status;
    END IF;
    v_next_version := v_app.current_version_no + 1;
    UPDATE public.expense_applications SET
      application_type = p_application_type,
      category_id = p_category_id,
      amount_yen = p_amount_yen,
      expense_date = p_expense_date,
      description = trim(p_description),
      current_version_no = v_next_version,
      status = CASE WHEN v_app.status = 'returned' THEN 'draft' ELSE v_app.status END
    WHERE id = v_app.id
    RETURNING * INTO v_app;
    PERFORM public.regapro_expense_append_version(v_app, v_actor);
  END IF;

  PERFORM public.regapro_write_expense_event(
    v_org, 'expense_application_drafted', 'expense_application', v_app.id,
    v_actor, v_app.staff_id, jsonb_build_object('amount_yen', v_app.amount_yen)
  );
  RETURN v_app;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_expense_application(p_application_id uuid)
RETURNS public.expense_applications
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_app public.expense_applications;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'EXPENSE_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('regapro.expense_rpc', '1', true);
  SELECT * INTO v_app FROM public.expense_applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EXPENSE_NOT_FOUND: expense application'; END IF;
  IF NOT public.regapro_staff_belongs_to_org(v_app.org_id) THEN
    RAISE EXCEPTION 'EXPENSE_FORBIDDEN: cross-org denied' USING ERRCODE = '42501';
  END IF;
  IF v_app.staff_id <> v_actor AND NOT public.regapro_staff_has_permission(v_app.org_id, 'expense.manage') THEN
    RAISE EXCEPTION 'EXPENSE_FORBIDDEN: cannot submit for another staff' USING ERRCODE = '42501';
  END IF;
  IF v_app.status NOT IN ('draft', 'returned') THEN
    RAISE EXCEPTION 'EXPENSE_INVALID_TRANSITION: cannot submit from %', v_app.status;
  END IF;
  UPDATE public.expense_applications SET
    status = 'pending',
    submitted_at = now(),
    submitted_by_staff_id = v_actor,
    returned_at = NULL,
    returned_by_staff_id = NULL,
    return_reason = NULL,
    approved_at = NULL,
    approved_by_staff_id = NULL
  WHERE id = v_app.id RETURNING * INTO v_app;
  PERFORM public.regapro_write_expense_event(
    v_app.org_id, 'expense_application_submitted', 'expense_application', v_app.id,
    v_actor, v_app.staff_id, jsonb_build_object('amount_yen', v_app.amount_yen)
  );
  RETURN v_app;
END;
$$;

CREATE OR REPLACE FUNCTION public.return_expense_application(p_application_id uuid, p_reason text)
RETURNS public.expense_applications
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_app public.expense_applications;
  v_reason text := trim(p_reason);
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'EXPENSE_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('regapro.expense_rpc', '1', true);
  IF char_length(v_reason) < 3 THEN
    RAISE EXCEPTION 'EXPENSE_INVALID_REASON: return reason too short';
  END IF;
  SELECT * INTO v_app FROM public.expense_applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EXPENSE_NOT_FOUND: expense application'; END IF;
  IF NOT public.regapro_staff_has_permission(v_app.org_id, 'expense.manage') THEN
    RAISE EXCEPTION 'EXPENSE_FORBIDDEN: expense.manage required' USING ERRCODE = '42501';
  END IF;
  IF v_app.staff_id = v_actor THEN
    RAISE EXCEPTION 'EXPENSE_SELF_REVIEW: cannot review own expense application';
  END IF;
  IF v_app.status <> 'pending' THEN
    RAISE EXCEPTION 'EXPENSE_INVALID_TRANSITION: cannot return from %', v_app.status;
  END IF;
  UPDATE public.expense_applications SET
    status = 'returned',
    returned_at = now(),
    returned_by_staff_id = v_actor,
    return_reason = v_reason
  WHERE id = v_app.id RETURNING * INTO v_app;
  PERFORM public.regapro_write_expense_event(
    v_app.org_id, 'expense_application_returned', 'expense_application', v_app.id,
    v_actor, v_app.staff_id, jsonb_build_object('reason', v_reason)
  );
  RETURN v_app;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_expense_application(p_application_id uuid)
RETURNS public.expense_applications
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_app public.expense_applications;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'EXPENSE_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('regapro.expense_rpc', '1', true);
  SELECT * INTO v_app FROM public.expense_applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EXPENSE_NOT_FOUND: expense application'; END IF;
  IF NOT public.regapro_staff_has_permission(v_app.org_id, 'expense.manage') THEN
    RAISE EXCEPTION 'EXPENSE_FORBIDDEN: expense.manage required' USING ERRCODE = '42501';
  END IF;
  IF v_app.staff_id = v_actor THEN
    RAISE EXCEPTION 'EXPENSE_SELF_REVIEW: cannot review own expense application';
  END IF;
  IF v_app.status <> 'pending' THEN
    RAISE EXCEPTION 'EXPENSE_INVALID_TRANSITION: cannot approve from %', v_app.status;
  END IF;
  UPDATE public.expense_applications SET
    status = 'approved',
    approved_at = now(),
    approved_by_staff_id = v_actor
  WHERE id = v_app.id RETURNING * INTO v_app;
  PERFORM public.regapro_write_expense_event(
    v_app.org_id, 'expense_application_approved', 'expense_application', v_app.id,
    v_actor, v_app.staff_id, jsonb_build_object('amount_yen', v_app.amount_yen)
  );
  RETURN v_app;
END;
$$;

CREATE OR REPLACE FUNCTION public.attach_expense_application_receipt(
  p_application_id uuid,
  p_file_object_id uuid
) RETURNS public.expense_applications
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_app public.expense_applications;
  v_next integer;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'EXPENSE_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('regapro.expense_rpc', '1', true);
  SELECT * INTO v_app FROM public.expense_applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EXPENSE_NOT_FOUND: expense application'; END IF;
  IF v_app.status = 'approved' THEN
    RAISE EXCEPTION 'EXPENSE_INVALID_TRANSITION: approved application is immutable';
  END IF;
  IF v_app.staff_id <> v_actor AND NOT public.regapro_staff_has_permission(v_app.org_id, 'expense.manage') THEN
    RAISE EXCEPTION 'EXPENSE_FORBIDDEN: cannot attach receipt for another staff' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.file_objects fo
    WHERE fo.id = p_file_object_id AND fo.org_id = v_app.org_id AND fo.bucket = 'expense-receipts'
      AND fo.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'EXPENSE_NOT_FOUND: receipt file_object';
  END IF;
  v_next := v_app.current_version_no + 1;
  UPDATE public.expense_applications SET
    file_object_id = p_file_object_id,
    current_version_no = v_next
  WHERE id = v_app.id RETURNING * INTO v_app;
  PERFORM public.regapro_expense_append_version(v_app, v_actor);
  PERFORM public.regapro_write_expense_event(
    v_app.org_id, 'expense_receipt_attached', 'expense_application', v_app.id,
    v_actor, v_app.staff_id, jsonb_build_object('file_object_id', p_file_object_id)
  );
  RETURN v_app;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_personal_sales_case(
  p_occurred_on date,
  p_title text,
  p_total_amount_yen integer,
  p_note text,
  p_staff_id uuid,
  p_allocations jsonb,
  p_allocation_rule_version_id uuid
) RETURNS public.personal_sales_cases
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_org uuid;
  v_case public.personal_sales_cases;
  v_row jsonb;
  v_sum integer := 0;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'SALES_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('regapro.personal_sales_rpc', '1', true);
  SELECT s.org_id INTO v_org FROM public.staff s
  WHERE s.staff_id = v_actor AND s.status = 'active';
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'SALES_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  IF NOT public.regapro_staff_has_permission(v_org, 'sales.manage') THEN
    RAISE EXCEPTION 'SALES_FORBIDDEN: sales.manage required' USING ERRCODE = '42501';
  END IF;
  IF p_total_amount_yen IS NULL OR p_total_amount_yen <= 0 THEN
    RAISE EXCEPTION 'SALES_INVALID_ALLOCATION: total amount invalid';
  END IF;
  IF p_allocation_rule_version_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.personal_sales_allocation_rule_versions r
      WHERE r.id = p_allocation_rule_version_id AND r.org_id = v_org AND r.status = 'approved'
    ) THEN
      RAISE EXCEPTION 'SALES_NO_APPROVED_RULE: allocation rule must be approved';
    END IF;
  END IF;
  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_allocations, '[]'::jsonb)) LOOP
    v_sum := v_sum + (v_row->>'amountYen')::integer;
  END LOOP;
  IF v_sum <> p_total_amount_yen THEN
    RAISE EXCEPTION 'SALES_INVALID_ALLOCATION: allocation amounts must sum to total';
  END IF;

  INSERT INTO public.personal_sales_cases (
    org_id, staff_id, occurred_on, title, total_amount_yen, status, note, created_by_staff_id
  ) VALUES (
    v_org, COALESCE(p_staff_id, v_actor), p_occurred_on, trim(p_title), p_total_amount_yen, 'active', p_note, v_actor
  ) RETURNING * INTO v_case;

  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_allocations, '[]'::jsonb)) LOOP
    INSERT INTO public.personal_sales_allocations (
      case_id, org_id, staff_id, share_rate_bps, amount_yen, allocation_rule_version_id
    ) VALUES (
      v_case.id, v_org, (v_row->>'staffId')::uuid, (v_row->>'shareRateBps')::integer,
      (v_row->>'amountYen')::integer, p_allocation_rule_version_id
    );
  END LOOP;

  PERFORM public.regapro_write_personal_sales_event(
    v_org, 'personal_sales_case_created', 'personal_sales_case', v_case.id,
    v_actor, v_case.staff_id, jsonb_build_object('total_amount_yen', v_case.total_amount_yen)
  );
  RETURN v_case;
END;
$$;

CREATE OR REPLACE FUNCTION public.void_personal_sales_case(p_case_id uuid, p_reason text)
RETURNS public.personal_sales_cases
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_case public.personal_sales_cases;
BEGIN
  PERFORM set_config('regapro.personal_sales_rpc', '1', true);
  SELECT * INTO v_case FROM public.personal_sales_cases WHERE id = p_case_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SALES_NOT_FOUND: personal sales case'; END IF;
  IF NOT public.regapro_staff_has_permission(v_case.org_id, 'sales.manage') THEN
    RAISE EXCEPTION 'SALES_FORBIDDEN: sales.manage required' USING ERRCODE = '42501';
  END IF;
  IF v_case.status <> 'active' THEN
    RAISE EXCEPTION 'SALES_INVALID_TRANSITION: cannot void from %', v_case.status;
  END IF;
  UPDATE public.personal_sales_cases SET status = 'voided' WHERE id = v_case.id RETURNING * INTO v_case;
  PERFORM public.regapro_write_personal_sales_event(
    v_case.org_id, 'personal_sales_case_voided', 'personal_sales_case', v_case.id,
    v_actor, v_case.staff_id, jsonb_build_object('reason', trim(p_reason))
  );
  RETURN v_case;
END;
$$;

CREATE OR REPLACE FUNCTION public.correct_personal_sales_case(
  p_case_id uuid,
  p_occurred_on date,
  p_title text,
  p_total_amount_yen integer,
  p_note text,
  p_allocations jsonb,
  p_reason text
) RETURNS public.personal_sales_cases
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_old public.personal_sales_cases;
  v_new public.personal_sales_cases;
  v_row jsonb;
  v_sum integer := 0;
BEGIN
  PERFORM set_config('regapro.personal_sales_rpc', '1', true);
  SELECT * INTO v_old FROM public.personal_sales_cases WHERE id = p_case_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SALES_NOT_FOUND: personal sales case'; END IF;
  IF NOT public.regapro_staff_has_permission(v_old.org_id, 'sales.manage') THEN
    RAISE EXCEPTION 'SALES_FORBIDDEN: sales.manage required' USING ERRCODE = '42501';
  END IF;
  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_allocations, '[]'::jsonb)) LOOP
    v_sum := v_sum + (v_row->>'amountYen')::integer;
  END LOOP;
  IF v_sum <> p_total_amount_yen THEN
    RAISE EXCEPTION 'SALES_INVALID_ALLOCATION: allocation amounts must sum to total';
  END IF;
  UPDATE public.personal_sales_cases SET status = 'corrected' WHERE id = v_old.id;
  INSERT INTO public.personal_sales_cases (
    org_id, staff_id, occurred_on, title, total_amount_yen, status, note,
    corrected_case_id, created_by_staff_id
  ) VALUES (
    v_old.org_id, v_old.staff_id, p_occurred_on, trim(p_title), p_total_amount_yen, 'active', p_note,
    v_old.id, v_actor
  ) RETURNING * INTO v_new;
  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_allocations, '[]'::jsonb)) LOOP
    INSERT INTO public.personal_sales_allocations (
      case_id, org_id, staff_id, share_rate_bps, amount_yen
    ) VALUES (
      v_new.id, v_new.org_id, (v_row->>'staffId')::uuid, (v_row->>'shareRateBps')::integer,
      (v_row->>'amountYen')::integer
    );
  END LOOP;
  PERFORM public.regapro_write_personal_sales_event(
    v_new.org_id, 'personal_sales_case_corrected', 'personal_sales_case', v_new.id,
    v_actor, v_new.staff_id, jsonb_build_object('reason', trim(p_reason), 'from_case_id', v_old.id)
  );
  RETURN v_new;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_personal_sales_allocation_rule_draft(
  p_effective_from date,
  p_effective_to date,
  p_rule_payload jsonb
) RETURNS public.personal_sales_allocation_rule_versions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public.regapro_current_staff_id();
  v_org uuid;
  v_version integer;
  v_rule public.personal_sales_allocation_rule_versions;
BEGIN
  PERFORM set_config('regapro.personal_sales_rpc', '1', true);
  SELECT s.org_id INTO v_org FROM public.staff s
  WHERE s.staff_id = v_actor AND s.status = 'active';
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'SALES_FORBIDDEN: inactive or unlinked staff' USING ERRCODE = '42501';
  END IF;
  IF NOT public.regapro_staff_has_permission(v_org, 'sales.manage') THEN
    RAISE EXCEPTION 'SALES_FORBIDDEN: sales.manage required' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(max(version), 0) + 1 INTO v_version
  FROM public.personal_sales_allocation_rule_versions WHERE org_id = v_org;
  INSERT INTO public.personal_sales_allocation_rule_versions (
    org_id, version, status, effective_from, effective_to, rule_payload, created_by_staff_id
  ) VALUES (
    v_org, v_version, 'draft', p_effective_from, p_effective_to, COALESCE(p_rule_payload, '{}'::jsonb), v_actor
  ) RETURNING * INTO v_rule;
  RETURN v_rule;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_personal_sales_allocation_rule(p_rule_version_id uuid)
RETURNS public.personal_sales_allocation_rule_versions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rule public.personal_sales_allocation_rule_versions;
  v_actor uuid := public.regapro_current_staff_id();
BEGIN
  PERFORM set_config('regapro.personal_sales_rpc', '1', true);
  SELECT * INTO v_rule FROM public.personal_sales_allocation_rule_versions WHERE id = p_rule_version_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SALES_NOT_FOUND: allocation rule'; END IF;
  IF NOT public.regapro_staff_has_permission(v_rule.org_id, 'sales.manage') THEN
    RAISE EXCEPTION 'SALES_FORBIDDEN: sales.manage required' USING ERRCODE = '42501';
  END IF;
  IF v_rule.status <> 'draft' THEN
    RAISE EXCEPTION 'SALES_INVALID_TRANSITION: cannot approve from %', v_rule.status;
  END IF;
  UPDATE public.personal_sales_allocation_rule_versions SET
    status = 'approved', approved_at = now(), approved_by_staff_id = v_actor
  WHERE id = v_rule.id RETURNING * INTO v_rule;
  RETURN v_rule;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_personal_sales_allocation_rule(
  p_rule_version_id uuid,
  p_reason text
) RETURNS public.personal_sales_allocation_rule_versions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rule public.personal_sales_allocation_rule_versions;
  v_actor uuid := public.regapro_current_staff_id();
BEGIN
  PERFORM set_config('regapro.personal_sales_rpc', '1', true);
  SELECT * INTO v_rule FROM public.personal_sales_allocation_rule_versions WHERE id = p_rule_version_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SALES_NOT_FOUND: allocation rule'; END IF;
  IF NOT public.regapro_staff_has_permission(v_rule.org_id, 'sales.manage') THEN
    RAISE EXCEPTION 'SALES_FORBIDDEN: sales.manage required' USING ERRCODE = '42501';
  END IF;
  IF v_rule.status <> 'approved' THEN
    RAISE EXCEPTION 'SALES_INVALID_TRANSITION: cannot revoke from %', v_rule.status;
  END IF;
  UPDATE public.personal_sales_allocation_rule_versions SET
    status = 'revoked', revoked_at = now(), revoked_by_staff_id = v_actor, revoke_reason = trim(p_reason)
  WHERE id = v_rule.id RETURNING * INTO v_rule;
  RETURN v_rule;
END;
$$;

ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_application_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_sales_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_sales_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_sales_allocation_rule_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_sales_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY expense_categories_select ON public.expense_categories
  FOR SELECT TO authenticated
  USING (public.regapro_has_any_expense_permission(org_id));

CREATE POLICY expense_applications_select ON public.expense_applications
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.regapro_staff_belongs_to_org(org_id)
    AND (
      staff_id = public.regapro_current_staff_id()
      OR public.regapro_staff_has_permission(org_id, 'expense.manage')
    )
  );

-- Receipt metadata readable when the linked application is readable (no public URLs).
DROP POLICY IF EXISTS file_objects_expense_receipt_select ON public.file_objects;
CREATE POLICY file_objects_expense_receipt_select ON public.file_objects
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND bucket = 'expense-receipts'
    AND EXISTS (
      SELECT 1 FROM public.expense_applications ea
      WHERE ea.file_object_id = file_objects.id
        AND ea.deleted_at IS NULL
        AND public.regapro_can_read_expense_application(ea.id)
    )
  );

CREATE POLICY expense_application_versions_select ON public.expense_application_versions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.expense_applications ea
      WHERE ea.id = expense_application_versions.application_id
        AND public.regapro_staff_belongs_to_org(ea.org_id)
        AND (
          ea.staff_id = public.regapro_current_staff_id()
          OR public.regapro_staff_has_permission(ea.org_id, 'expense.manage')
        )
    )
  );

CREATE POLICY expense_events_select ON public.expense_events
  FOR SELECT TO authenticated
  USING (public.regapro_staff_has_permission(org_id, 'expense.manage'));

CREATE POLICY personal_sales_cases_select ON public.personal_sales_cases
  FOR SELECT TO authenticated
  USING (
    public.regapro_staff_belongs_to_org(org_id)
    AND (
      public.regapro_staff_has_permission(org_id, 'sales.manage')
      OR (
        staff_id IS NOT NULL
        AND staff_id = public.regapro_current_staff_id()
      )
      OR EXISTS (
        SELECT 1 FROM public.personal_sales_allocations a
        WHERE a.case_id = personal_sales_cases.id
          AND a.staff_id = public.regapro_current_staff_id()
      )
    )
  );

CREATE POLICY personal_sales_allocations_select ON public.personal_sales_allocations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.personal_sales_cases c
      WHERE c.id = personal_sales_allocations.case_id
        AND public.regapro_staff_belongs_to_org(c.org_id)
        AND (
          public.regapro_staff_has_permission(c.org_id, 'sales.manage')
          OR c.staff_id = public.regapro_current_staff_id()
          OR personal_sales_allocations.staff_id = public.regapro_current_staff_id()
        )
    )
  );

CREATE POLICY personal_sales_rules_select ON public.personal_sales_allocation_rule_versions
  FOR SELECT TO authenticated
  USING (public.regapro_staff_has_permission(org_id, 'sales.manage'));

CREATE POLICY personal_sales_events_select ON public.personal_sales_events
  FOR SELECT TO authenticated
  USING (public.regapro_staff_has_permission(org_id, 'sales.manage'));

GRANT SELECT ON TABLE public.expense_categories TO authenticated;
GRANT SELECT ON TABLE public.expense_applications TO authenticated;
GRANT SELECT ON TABLE public.expense_application_versions TO authenticated;
GRANT SELECT ON TABLE public.expense_events TO authenticated;
GRANT SELECT ON TABLE public.personal_sales_cases TO authenticated;
GRANT SELECT ON TABLE public.personal_sales_allocations TO authenticated;
GRANT SELECT ON TABLE public.personal_sales_allocation_rule_versions TO authenticated;
GRANT SELECT ON TABLE public.personal_sales_events TO authenticated;

GRANT ALL ON TABLE public.expense_categories TO service_role;
GRANT ALL ON TABLE public.expense_applications TO service_role;
GRANT ALL ON TABLE public.expense_application_versions TO service_role;
GRANT ALL ON TABLE public.expense_events TO service_role;
GRANT ALL ON TABLE public.personal_sales_cases TO service_role;
GRANT ALL ON TABLE public.personal_sales_allocations TO service_role;
GRANT ALL ON TABLE public.personal_sales_allocation_rule_versions TO service_role;
GRANT ALL ON TABLE public.personal_sales_events TO service_role;

REVOKE ALL ON FUNCTION public.upsert_expense_application_draft(uuid, uuid, text, uuid, integer, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_expense_application(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.return_expense_application(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_expense_application(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.attach_expense_application_receipt(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_personal_sales_case(date, text, integer, text, uuid, jsonb, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.void_personal_sales_case(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.correct_personal_sales_case(uuid, date, text, integer, text, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.upsert_personal_sales_allocation_rule_draft(date, date, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_personal_sales_allocation_rule(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_personal_sales_allocation_rule(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.regapro_has_any_expense_permission(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.regapro_has_any_sales_permission(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.upsert_expense_application_draft(uuid, uuid, text, uuid, integer, date, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_expense_application(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.return_expense_application(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_expense_application(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.attach_expense_application_receipt(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_personal_sales_case(date, text, integer, text, uuid, jsonb, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.void_personal_sales_case(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.correct_personal_sales_case(uuid, date, text, integer, text, jsonb, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_personal_sales_allocation_rule_draft(date, date, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_personal_sales_allocation_rule(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_personal_sales_allocation_rule(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regapro_has_any_expense_permission(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regapro_has_any_sales_permission(uuid) TO authenticated, service_role;
