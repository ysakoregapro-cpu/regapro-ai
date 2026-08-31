-- Atomic staff identity backfill from existing auth.users + AI membership.
--
-- Single Postgres transaction: staff + staff_identities + staff_role_assignments +
-- permission_audit_events. Rolls back entirely on any failure.
--
-- Callable only via service_role (maintenance script). Not exposed to authenticated.
-- SECURITY DEFINER with fixed search_path.
--
-- Forward-only. Do not apply to linked production without review.

-- Collect AI-axis permission keys for a user's org membership.
CREATE OR REPLACE FUNCTION public.regapro_membership_ai_permissions(
  p_user_id uuid,
  p_org_id uuid
)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT p.key ORDER BY p.key), ARRAY[]::text[])
  FROM public.organization_memberships om
  JOIN public.membership_roles mr
    ON mr.membership_id = om.id AND mr.deleted_at IS NULL
  JOIN public.roles r
    ON r.id = mr.role_id AND r.deleted_at IS NULL
  JOIN public.role_permissions rp
    ON rp.role_id = r.id AND rp.deleted_at IS NULL
  JOIN public.permissions p
    ON p.id = rp.permission_id AND p.deleted_at IS NULL
  WHERE om.user_id = p_user_id
    AND om.org_id = p_org_id
    AND om.deleted_at IS NULL;
$$;

-- Derive platform role template keys from actual AI permission keys (not role names).
CREATE OR REPLACE FUNCTION public.regapro_derive_platform_roles_from_ai_permissions(
  p_ai_permission_keys text[]
)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_roles text[] := ARRAY['platform_base'];
  v_admin_markers text[] := ARRAY[
    'member:manage', 'organization:manage', 'audit:read', 'system:diagnose'
  ];
  v_coding_markers text[] := ARRAY[
    'coding:use', 'coding:device_pair', 'coding:workspace_write'
  ];
BEGIN
  IF p_ai_permission_keys IS NULL OR cardinality(p_ai_permission_keys) = 0 THEN
    RETURN v_roles;
  END IF;

  IF p_ai_permission_keys && ARRAY['chat:use']::text[] THEN
    v_roles := array_append(v_roles, 'platform_ai_user');
  END IF;

  IF p_ai_permission_keys && v_coding_markers THEN
    v_roles := array_append(v_roles, 'platform_coding_user');
  END IF;

  IF p_ai_permission_keys && v_admin_markers THEN
    v_roles := array_append(v_roles, 'platform_admin');
  END IF;

  RETURN (
    SELECT array_agg(DISTINCT r ORDER BY r)
    FROM unnest(v_roles) AS r
  );
END;
$$;

-- Expected platform permission keys after bridging legacy AI permissions.
CREATE OR REPLACE FUNCTION public.regapro_expected_platform_permissions_from_ai(
  p_ai_permission_keys text[]
)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_perms text[] := ARRAY['mypage.use'];
  v_key text;
BEGIN
  IF p_ai_permission_keys IS NULL THEN
    RETURN v_perms;
  END IF;

  FOREACH v_key IN ARRAY p_ai_permission_keys LOOP
    CASE v_key
      WHEN 'chat:use' THEN
        IF NOT ('ai.use' = ANY (v_perms)) THEN v_perms := array_append(v_perms, 'ai.use'); END IF;
      WHEN 'task:read' THEN
        IF NOT ('tasks.use' = ANY (v_perms)) THEN v_perms := array_append(v_perms, 'tasks.use'); END IF;
      WHEN 'coding:use' THEN
        IF NOT ('coding.use' = ANY (v_perms)) THEN v_perms := array_append(v_perms, 'coding.use'); END IF;
      WHEN 'coding:device_pair' THEN
        IF NOT ('coding.local_agent' = ANY (v_perms)) THEN v_perms := array_append(v_perms, 'coding.local_agent'); END IF;
      WHEN 'coding:workspace_write' THEN
        IF NOT ('coding.local_agent' = ANY (v_perms)) THEN v_perms := array_append(v_perms, 'coding.local_agent'); END IF;
      WHEN 'member:manage' THEN
        IF NOT ('admin.access' = ANY (v_perms)) THEN v_perms := array_append(v_perms, 'admin.access'); END IF;
        IF NOT ('admin.staff_manage' = ANY (v_perms)) THEN v_perms := array_append(v_perms, 'admin.staff_manage'); END IF;
      WHEN 'organization:manage' THEN
        IF NOT ('admin.access' = ANY (v_perms)) THEN v_perms := array_append(v_perms, 'admin.access'); END IF;
        IF NOT ('admin.staff_manage' = ANY (v_perms)) THEN v_perms := array_append(v_perms, 'admin.staff_manage'); END IF;
        IF NOT ('admin.role_manage' = ANY (v_perms)) THEN v_perms := array_append(v_perms, 'admin.role_manage'); END IF;
      WHEN 'audit:read' THEN
        IF NOT ('admin.access' = ANY (v_perms)) THEN v_perms := array_append(v_perms, 'admin.access'); END IF;
      WHEN 'system:diagnose' THEN
        IF NOT ('admin.access' = ANY (v_perms)) THEN v_perms := array_append(v_perms, 'admin.access'); END IF;
      ELSE
        NULL;
    END CASE;
  END LOOP;

  RETURN (SELECT array_agg(DISTINCT p ORDER BY p) FROM unnest(v_perms) AS p);
END;
$$;

-- Collect platform permissions granted to a staff member via role assignments.
CREATE OR REPLACE FUNCTION public.regapro_staff_platform_permissions(
  p_staff_id uuid,
  p_org_id uuid
)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT p.key ORDER BY p.key), ARRAY[]::text[])
  FROM public.staff_role_assignments sra
  JOIN public.roles r ON r.id = sra.role_id AND r.deleted_at IS NULL
  JOIN public.role_permissions rp ON rp.role_id = r.id AND rp.deleted_at IS NULL
  JOIN public.permissions p ON p.id = rp.permission_id AND p.deleted_at IS NULL
  WHERE sra.staff_id = p_staff_id
    AND sra.org_id = p_org_id
    AND sra.deleted_at IS NULL
    AND (sra.expires_at IS NULL OR sra.expires_at > now());
$$;

-- Atomic backfill: staff + identity + platform role assignments + audit.
CREATE OR REPLACE FUNCTION public.regapro_backfill_staff_from_auth(
  p_auth_user_id uuid,
  p_employment_type text,
  p_actor_auth_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_staff_id uuid;
  v_org_id uuid;
  v_membership_id uuid;
  v_department_id uuid;
  v_display_name text;
  v_staff_id uuid;
  v_staff_no text;
  v_ai_permissions text[];
  v_platform_roles text[];
  v_expected_platform text[];
  v_actual_platform text[];
  v_role_key text;
  v_role_id uuid;
  v_perm text;
  v_ai_markers text[] := ARRAY[
    'chat:use', 'coding:use', 'knowledge:read', 'research:run', 'task:read'
  ];
BEGIN
  IF p_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'backfill_auth_required';
  END IF;

  IF p_employment_type IS NULL
     OR p_employment_type NOT IN ('executive', 'employee', 'part_time') THEN
    RAISE EXCEPTION 'backfill_invalid_employment_type: %', COALESCE(p_employment_type, '(null)');
  END IF;

  -- Idempotency: already linked app_auth identity.
  SELECT si.staff_id INTO v_existing_staff_id
  FROM public.staff_identities si
  WHERE si.auth_user_id = p_auth_user_id
    AND si.identity_type = 'app_auth'
  LIMIT 1;

  IF v_existing_staff_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', 'already_backfilled',
      'staff_id', v_existing_staff_id,
      'auth_user_id', p_auth_user_id
    );
  END IF;

  -- source_system + external_user_id uniqueness pre-check.
  IF EXISTS (
    SELECT 1 FROM public.staff_identities si
    WHERE si.source_system = 'regapro_app'
      AND si.external_user_id = p_auth_user_id::text
  ) THEN
    RAISE EXCEPTION 'backfill_identity_conflict: regapro_app/%', p_auth_user_id;
  END IF;

  -- Resolve membership (single org for now; first active membership).
  SELECT om.org_id, om.id, om.department_id
  INTO v_org_id, v_membership_id, v_department_id
  FROM public.organization_memberships om
  WHERE om.user_id = p_auth_user_id
    AND om.deleted_at IS NULL
  ORDER BY om.created_at
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'backfill_no_membership';
  END IF;

  -- Must have at least one membership role.
  IF NOT EXISTS (
    SELECT 1
    FROM public.membership_roles mr
    WHERE mr.membership_id = v_membership_id
      AND mr.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'backfill_no_membership_roles';
  END IF;

  v_ai_permissions := public.regapro_membership_ai_permissions(p_auth_user_id, v_org_id);

  -- Formal AI user criterion: permission-set based, not role name.
  IF NOT (v_ai_permissions && v_ai_markers) THEN
    RAISE EXCEPTION 'backfill_not_ai_user: permissions=%', v_ai_permissions;
  END IF;

  SELECT COALESCE(
    (SELECT pr.display_name FROM public.profiles pr
     WHERE pr.user_id = p_auth_user_id AND pr.deleted_at IS NULL
     LIMIT 1),
    split_part((SELECT email FROM auth.users WHERE id = p_auth_user_id), '@', 1),
    '利用者'
  ) INTO v_display_name;

  v_platform_roles := public.regapro_derive_platform_roles_from_ai_permissions(v_ai_permissions);
  v_expected_platform := public.regapro_expected_platform_permissions_from_ai(v_ai_permissions);

  -- Allocate staff_no atomically.
  v_staff_no := public.regapro_next_staff_no(v_org_id);
  v_staff_id := gen_random_uuid();

  INSERT INTO public.staff (
    staff_id, org_id, staff_no, name, employment_type, status
  ) VALUES (
    v_staff_id, v_org_id, v_staff_no, v_display_name, p_employment_type, 'active'
  );

  INSERT INTO public.staff_identities (
    staff_id, identity_type, source_system, external_user_id, auth_user_id, metadata
  ) VALUES (
    v_staff_id,
    'app_auth',
    'regapro_app',
    p_auth_user_id::text,
    p_auth_user_id,
    jsonb_build_object('backfill_source', 'regapro_backfill_staff_from_auth')
  );

  -- Platform role assignments (organization scope).
  FOREACH v_role_key IN ARRAY v_platform_roles LOOP
    SELECT r.id INTO v_role_id
    FROM public.roles r
    WHERE r.key = v_role_key
      AND r.deleted_at IS NULL
      AND r.org_id IS NULL
    LIMIT 1;

    IF v_role_id IS NULL THEN
      RAISE EXCEPTION 'backfill_platform_role_missing: %', v_role_key;
    END IF;

    INSERT INTO public.staff_role_assignments (
      org_id, staff_id, role_id, scope_type, scope_id, granted_by_staff_id
    ) VALUES (
      v_org_id, v_staff_id, v_role_id, 'organization', NULL, NULL
    );
  END LOOP;

  -- Permission preservation gate: every expected platform permission must be present.
  v_actual_platform := public.regapro_staff_platform_permissions(v_staff_id, v_org_id);

  FOREACH v_perm IN ARRAY v_expected_platform LOOP
    IF NOT (v_perm = ANY (v_actual_platform)) THEN
      RAISE EXCEPTION 'backfill_permission_regression: missing %', v_perm;
    END IF;
  END LOOP;

  -- Audit: staff created.
  INSERT INTO public.permission_audit_events (
    org_id, actor_auth_user_id, subject_staff_id, action, before, after
  ) VALUES (
    v_org_id,
    p_actor_auth_user_id,
    v_staff_id,
    'staff_created',
    NULL,
    jsonb_build_object(
      'staff_id', v_staff_id,
      'staff_no', v_staff_no,
      'employment_type', p_employment_type,
      'auth_user_id', p_auth_user_id
    )
  );

  -- Audit: identity linked.
  INSERT INTO public.permission_audit_events (
    org_id, actor_auth_user_id, subject_staff_id, action, before, after
  ) VALUES (
    v_org_id,
    p_actor_auth_user_id,
    v_staff_id,
    'identity_linked',
    NULL,
    jsonb_build_object(
      'identity_type', 'app_auth',
      'source_system', 'regapro_app',
      'auth_user_id', p_auth_user_id
    )
  );

  -- Audit: roles assigned.
  INSERT INTO public.permission_audit_events (
    org_id, actor_auth_user_id, subject_staff_id, action, before, after
  ) VALUES (
    v_org_id,
    p_actor_auth_user_id,
    v_staff_id,
    'role_assigned',
    NULL,
    jsonb_build_object(
      'platform_roles', to_jsonb(v_platform_roles),
      'ai_permission_keys', to_jsonb(v_ai_permissions)
    )
  );

  RETURN jsonb_build_object(
    'status', 'created',
    'staff_id', v_staff_id,
    'staff_no', v_staff_no,
    'auth_user_id', p_auth_user_id,
    'org_id', v_org_id,
    'employment_type', p_employment_type,
    'platform_roles', to_jsonb(v_platform_roles),
    'ai_permission_keys', to_jsonb(v_ai_permissions),
    'expected_platform_permissions', to_jsonb(v_expected_platform),
    'actual_platform_permissions', to_jsonb(v_actual_platform)
  );
END;
$$;

COMMENT ON FUNCTION public.regapro_backfill_staff_from_auth(uuid, text, uuid) IS
  'Atomic staff backfill from auth.users + AI membership. service_role only. Rolls back on any failure.';

REVOKE ALL ON FUNCTION public.regapro_membership_ai_permissions(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_derive_platform_roles_from_ai_permissions(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_expected_platform_permissions_from_ai(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_staff_platform_permissions(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regapro_backfill_staff_from_auth(uuid, text, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.regapro_membership_ai_permissions(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.regapro_derive_platform_roles_from_ai_permissions(text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.regapro_expected_platform_permissions_from_ai(text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.regapro_staff_platform_permissions(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.regapro_backfill_staff_from_auth(uuid, text, uuid) TO service_role;
