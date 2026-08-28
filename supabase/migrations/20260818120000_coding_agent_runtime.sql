-- Coding Agent Runtime: devices, workspaces, runs, command queue.
-- Do not apply to linked production without review.

INSERT INTO public.permissions (key, label)
VALUES
  ('coding:use', 'コーディング利用'),
  ('coding:device_pair', '端末ペアリング'),
  ('coding:workspace_write', 'Workspace書き込み'),
  ('coding:dangerous_approve', '危険操作の承認'),
  ('coding:device_manage', '端末管理')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.org_id IS NULL AND r.key = 'admin'
  AND p.key LIKE 'coding:%'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r, public.permissions p
WHERE r.org_id IS NULL AND r.key IN ('member', 'editor', 'manager')
  AND p.key IN ('coding:use', 'coding:device_pair')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r, public.permissions p
WHERE r.org_id IS NULL AND r.key IN ('editor', 'manager')
  AND p.key IN ('coding:workspace_write')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r, public.permissions p
WHERE r.org_id IS NULL AND r.key = 'manager'
  AND p.key = 'coding:dangerous_approve'
ON CONFLICT DO NOTHING;

CREATE TABLE public.coding_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label text NOT NULL,
  os text NOT NULL DEFAULT 'unknown'
    CHECK (os IN ('windows', 'macos', 'linux', 'unknown')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paired', 'revoked')),
  public_key_pem text NOT NULL,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_coding_devices_org_user ON public.coding_devices(org_id, user_id);

CREATE TABLE public.coding_pairing_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_coding_pairing_user ON public.coding_pairing_challenges(user_id, expires_at);

CREATE TABLE public.coding_workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES public.coding_devices(id) ON DELETE CASCADE,
  label text NOT NULL,
  root_path text NOT NULL,
  permission text NOT NULL DEFAULT 'read'
    CHECK (permission IN ('read', 'write')),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX idx_coding_workspaces_device ON public.coding_workspaces(device_id);

CREATE TABLE public.coding_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  thread_id uuid REFERENCES public.chat_threads(id),
  device_id uuid REFERENCES public.coding_devices(id),
  workspace_id uuid REFERENCES public.coding_workspaces(id),
  goal text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('pasted', 'workspace', 'vibe')),
  status text NOT NULL,
  plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  tool_names text[] NOT NULL DEFAULT '{}',
  changed_files text[] NOT NULL DEFAULT '{}',
  verification jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_coding_runs_thread ON public.coding_runs(thread_id);
CREATE INDEX idx_coding_runs_org ON public.coding_runs(org_id, started_at DESC);

CREATE TABLE public.coding_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  device_id uuid NOT NULL REFERENCES public.coding_devices(id) ON DELETE CASCADE,
  run_id uuid REFERENCES public.coding_runs(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  risk_level text NOT NULL CHECK (risk_level IN ('read', 'write', 'dangerous')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'claimed', 'done', 'blocked', 'failed')),
  result_meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  finished_at timestamptz
);
CREATE INDEX idx_coding_commands_device ON public.coding_commands(device_id, status);

CREATE TABLE public.coding_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.coding_runs(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  fingerprint text NOT NULL,
  summary text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied')),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.coding_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  actor_user_id uuid REFERENCES auth.users(id),
  device_id uuid,
  action text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_coding_audit_org ON public.coding_audit_events(org_id, created_at DESC);

COMMENT ON TABLE public.coding_runs IS
  'Coding Agent run metadata. Do not store secrets, huge logs, or full file bodies.';
COMMENT ON TABLE public.coding_devices IS
  'Paired Local Agent devices. Public key only. Never service_role.';

ALTER TABLE public.coding_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coding_pairing_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coding_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coding_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coding_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coding_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coding_audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY coding_devices_select ON public.coding_devices
  FOR SELECT USING (
    public.regapro_is_org_member(org_id)
    AND user_id = auth.uid()
  );
CREATE POLICY coding_devices_insert ON public.coding_devices
  FOR INSERT WITH CHECK (
    public.regapro_is_org_member(org_id)
    AND user_id = auth.uid()
  );
CREATE POLICY coding_devices_update ON public.coding_devices
  FOR UPDATE USING (
    public.regapro_is_org_member(org_id)
    AND user_id = auth.uid()
  );

CREATE POLICY coding_pairing_select ON public.coding_pairing_challenges
  FOR SELECT USING (
    public.regapro_is_org_member(org_id)
    AND user_id = auth.uid()
  );
CREATE POLICY coding_pairing_insert ON public.coding_pairing_challenges
  FOR INSERT WITH CHECK (
    public.regapro_is_org_member(org_id)
    AND user_id = auth.uid()
  );

CREATE POLICY coding_workspaces_select ON public.coding_workspaces
  FOR SELECT USING (
    public.regapro_is_org_member(org_id)
    AND user_id = auth.uid()
  );
CREATE POLICY coding_workspaces_write ON public.coding_workspaces
  FOR INSERT WITH CHECK (
    public.regapro_is_org_member(org_id)
    AND user_id = auth.uid()
  );
CREATE POLICY coding_workspaces_update ON public.coding_workspaces
  FOR UPDATE USING (
    public.regapro_is_org_member(org_id)
    AND user_id = auth.uid()
  );

CREATE POLICY coding_runs_select ON public.coding_runs
  FOR SELECT USING (
    public.regapro_is_org_member(org_id)
    AND user_id = auth.uid()
  );
CREATE POLICY coding_runs_insert ON public.coding_runs
  FOR INSERT WITH CHECK (
    public.regapro_is_org_member(org_id)
    AND user_id = auth.uid()
  );
CREATE POLICY coding_runs_update ON public.coding_runs
  FOR UPDATE USING (
    public.regapro_is_org_member(org_id)
    AND user_id = auth.uid()
  );

CREATE POLICY coding_commands_select ON public.coding_commands
  FOR SELECT USING (
    public.regapro_is_org_member(org_id)
    AND EXISTS (
      SELECT 1 FROM public.coding_devices d
      WHERE d.id = coding_commands.device_id
        AND d.user_id = auth.uid()
    )
  );

CREATE POLICY coding_approvals_select ON public.coding_approvals
  FOR SELECT USING (
    public.regapro_is_org_member(org_id)
    AND user_id = auth.uid()
  );
CREATE POLICY coding_approvals_write ON public.coding_approvals
  FOR INSERT WITH CHECK (
    public.regapro_is_org_member(org_id)
    AND user_id = auth.uid()
  );
CREATE POLICY coding_approvals_update ON public.coding_approvals
  FOR UPDATE USING (
    public.regapro_is_org_member(org_id)
    AND user_id = auth.uid()
  );

CREATE POLICY coding_audit_select ON public.coding_audit_events
  FOR SELECT USING (
    public.regapro_is_org_member(org_id)
    AND public.regapro_has_permission(org_id, 'audit:read')
  );
