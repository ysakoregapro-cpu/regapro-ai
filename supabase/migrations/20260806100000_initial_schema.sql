-- Regapro AI initial schema
-- Local development only — do not apply to remote without review.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ---------------------------------------------------------------------------
-- Helpers (mirrored in @regapro/security as pure TS documentation)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.regapro_current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.regapro_is_org_member(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_memberships om
    WHERE om.org_id = p_org_id
      AND om.user_id = auth.uid()
      AND om.deleted_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.regapro_has_permission(p_org_id uuid, p_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_memberships om
    JOIN public.membership_roles mr ON mr.membership_id = om.id AND mr.deleted_at IS NULL
    JOIN public.roles r ON r.id = mr.role_id AND r.deleted_at IS NULL
    JOIN public.role_permissions rp ON rp.role_id = r.id AND rp.deleted_at IS NULL
    JOIN public.permissions p ON p.id = rp.permission_id AND p.deleted_at IS NULL
    WHERE om.org_id = p_org_id
      AND om.user_id = auth.uid()
      AND om.deleted_at IS NULL
      AND p.key = p_permission
  );
$$;

-- ---------------------------------------------------------------------------
-- Core org / auth tables
-- ---------------------------------------------------------------------------

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE public.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX idx_departments_org_id ON public.departments(org_id);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  avatar_url text,
  locale text NOT NULL DEFAULT 'ja-JP',
  timezone text NOT NULL DEFAULT 'Asia/Tokyo',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE public.organization_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  department_id uuid REFERENCES public.departments(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (org_id, user_id)
);
CREATE INDEX idx_org_memberships_org_id ON public.organization_memberships(org_id);
CREATE INDEX idx_org_memberships_user_id ON public.organization_memberships(user_id);

CREATE TABLE public.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES public.organizations(id),
  key text NOT NULL,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (org_id, key)
);

CREATE TABLE public.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE public.role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (role_id, permission_id)
);

CREATE TABLE public.membership_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id uuid NOT NULL REFERENCES public.organization_memberships(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (membership_id, role_id)
);

CREATE TABLE public.organization_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  email text NOT NULL,
  invited_by uuid REFERENCES auth.users(id),
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX idx_org_invitations_org_id ON public.organization_invitations(org_id);

-- ---------------------------------------------------------------------------
-- Projects & chat
-- ---------------------------------------------------------------------------

CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  name text NOT NULL,
  description text,
  visibility text NOT NULL DEFAULT 'team' CHECK (visibility IN ('private','team','department','project','organization')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX idx_projects_org_id ON public.projects(org_id);

CREATE TABLE public.project_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (project_id, user_id)
);

CREATE TABLE public.chat_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  project_id uuid REFERENCES public.projects(id),
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX idx_chat_threads_org_id ON public.chat_threads(org_id);

CREATE TABLE public.chat_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.chat_threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (thread_id, user_id)
);

CREATE TABLE public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.chat_threads(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id),
  role text NOT NULL CHECK (role IN ('user','assistant','system')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX idx_chat_messages_thread_id ON public.chat_messages(thread_id);

CREATE TABLE public.message_citations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  source_url text,
  source_title text,
  chunk_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE public.message_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  file_object_id uuid,
  file_name text NOT NULL,
  mime_type text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------

CREATE TABLE public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  project_id uuid REFERENCES public.projects(id),
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('draft','open','in_progress','blocked','completed','cancelled')),
  assignee_id uuid REFERENCES auth.users(id),
  due_at timestamptz,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX idx_tasks_org_id ON public.tasks(org_id);
CREATE INDEX idx_tasks_assignee_id ON public.tasks(assignee_id);

CREATE TABLE public.task_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  remind_at timestamptz NOT NULL,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE public.task_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id),
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','claimed','delivered','failed','cancelled')),
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX idx_notifications_user_id ON public.notifications(user_id);

CREATE TABLE public.notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('in_app','push','email')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','claimed','delivered','failed','retry')),
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  claimed_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  in_app_enabled boolean NOT NULL DEFAULT true,
  push_enabled boolean NOT NULL DEFAULT false,
  email_enabled boolean NOT NULL DEFAULT false,
  task_reminders_enabled boolean NOT NULL DEFAULT true,
  quiet_hours_start int,
  quiet_hours_end int,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Memory & knowledge
-- ---------------------------------------------------------------------------

CREATE TABLE public.memory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  user_id uuid REFERENCES auth.users(id),
  content text NOT NULL,
  embedding vector(1536),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE public.knowledge_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  name text NOT NULL,
  source_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE public.knowledge_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  source_id uuid NOT NULL REFERENCES public.knowledge_sources(id),
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','approved','published','superseded','expired','archived')),
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX idx_knowledge_documents_org_id ON public.knowledge_documents(org_id);

CREATE TABLE public.knowledge_document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.knowledge_documents(id) ON DELETE CASCADE,
  version_number int NOT NULL,
  body text NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (document_id, version_number)
);

CREATE TABLE public.knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_version_id uuid NOT NULL REFERENCES public.knowledge_document_versions(id) ON DELETE CASCADE,
  chunk_index int NOT NULL,
  content text NOT NULL,
  embedding vector(1536),
  token_count int,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE public.knowledge_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  document_id uuid REFERENCES public.knowledge_documents(id),
  fact_text text NOT NULL,
  confidence numeric(4,3),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE public.knowledge_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.knowledge_documents(id) ON DELETE CASCADE,
  from_status text NOT NULL,
  to_status text NOT NULL,
  changed_by uuid REFERENCES auth.users(id),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.knowledge_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.knowledge_documents(id) ON DELETE CASCADE,
  approver_id uuid NOT NULL REFERENCES auth.users(id),
  decision text NOT NULL CHECK (decision IN ('approved','rejected')),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Research
-- ---------------------------------------------------------------------------

CREATE TABLE public.research_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  project_id uuid REFERENCES public.projects(id),
  query text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed','cancelled')),
  budget_tokens int NOT NULL DEFAULT 10000,
  tokens_used int NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE public.research_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.research_runs(id) ON DELETE CASCADE,
  query_text text NOT NULL,
  provider text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.research_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.research_runs(id) ON DELETE CASCADE,
  url text NOT NULL,
  title text,
  fetched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.research_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.research_runs(id) ON DELETE CASCADE,
  summary text NOT NULL,
  source_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.research_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.research_runs(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  stage text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','claimed','completed','failed','retry')),
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Prompts
-- ---------------------------------------------------------------------------

CREATE TABLE public.prompt_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  name text NOT NULL,
  target text NOT NULL,
  template jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE public.generated_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  profile_id uuid REFERENCES public.prompt_profiles(id),
  target text NOT NULL,
  content text NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE public.prompt_execution_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id uuid NOT NULL REFERENCES public.generated_prompts(id) ON DELETE CASCADE,
  status text NOT NULL,
  output text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Artifacts & tooling
-- ---------------------------------------------------------------------------

CREATE TABLE public.artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  project_id uuid REFERENCES public.projects(id),
  title text NOT NULL,
  format text NOT NULL CHECK (format IN ('markdown','pdf','docx','xlsx','pptx')),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE public.artifact_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL REFERENCES public.artifacts(id) ON DELETE CASCADE,
  version_number int NOT NULL,
  storage_path text,
  checksum text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (artifact_id, version_number)
);

CREATE TABLE public.artifact_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL REFERENCES public.artifacts(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','claimed','completed','failed','retry')),
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE public.citations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  source_url text,
  source_title text,
  accessed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.tool_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  tool_name text NOT NULL,
  input jsonb NOT NULL DEFAULT '{}',
  output jsonb,
  status text NOT NULL,
  error text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  actor_id uuid REFERENCES auth.users(id),
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_logs_org_id ON public.audit_logs(org_id);

CREATE TABLE public.user_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  user_id uuid REFERENCES auth.users(id),
  resource_type text NOT NULL,
  resource_id uuid,
  rating int CHECK (rating BETWEEN 1 AND 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.file_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  bucket text NOT NULL,
  path text NOT NULL,
  mime_type text,
  size_bytes bigint,
  checksum text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (bucket, path)
);

-- ---------------------------------------------------------------------------
-- Seed permissions & global roles
-- ---------------------------------------------------------------------------

INSERT INTO public.permissions (key, label) VALUES
  ('chat:use', 'Use chat'),
  ('knowledge:read', 'Read knowledge'),
  ('knowledge:write', 'Write knowledge'),
  ('knowledge:review', 'Review knowledge'),
  ('knowledge:approve', 'Approve knowledge'),
  ('research:run', 'Run research'),
  ('artifact:generate', 'Generate artifacts'),
  ('prompt:generate', 'Generate prompts'),
  ('project:read', 'Read projects'),
  ('project:manage', 'Manage projects'),
  ('task:read', 'Read tasks'),
  ('task:create', 'Create tasks'),
  ('task:update', 'Update tasks'),
  ('task:complete', 'Complete tasks'),
  ('task:assign', 'Assign tasks'),
  ('task:manage', 'Manage tasks'),
  ('task:notification_manage', 'Manage task notifications'),
  ('organization:manage', 'Manage organization'),
  ('member:manage', 'Manage members'),
  ('audit:read', 'Read audit logs'),
  ('system:diagnose', 'Run system diagnostics')
ON CONFLICT (key) DO NOTHING;

-- Global role templates (org_id NULL = template)
INSERT INTO public.roles (org_id, key, label) VALUES
  (NULL, 'member', 'Member'),
  (NULL, 'editor', 'Editor'),
  (NULL, 'manager', 'Manager'),
  (NULL, 'admin', 'Admin')
ON CONFLICT DO NOTHING;

-- Role-permission mapping (using subqueries)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.org_id IS NULL AND r.key = 'admin'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r, public.permissions p
WHERE r.org_id IS NULL AND r.key = 'member'
  AND p.key IN ('chat:use','knowledge:read','project:read','task:read','task:create','task:update','task:complete')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r, public.permissions p
WHERE r.org_id IS NULL AND r.key = 'editor'
  AND p.key IN ('chat:use','knowledge:read','knowledge:write','research:run','artifact:generate','prompt:generate','project:read','task:read','task:create','task:update','task:complete','task:assign')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r, public.permissions p
WHERE r.org_id IS NULL AND r.key = 'manager'
  AND p.key IN ('chat:use','knowledge:read','knowledge:write','knowledge:review','research:run','artifact:generate','prompt:generate','project:read','project:manage','task:read','task:create','task:update','task:complete','task:assign','task:manage','task:notification_manage','member:manage','audit:read')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_citations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generated_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_execution_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artifact_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artifact_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.citations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.file_objects ENABLE ROW LEVEL SECURITY;

-- Generic org-scoped policies (SELECT for members, writes require permission where noted)
CREATE POLICY org_member_select ON public.projects
  FOR SELECT USING (public.regapro_is_org_member(org_id));

CREATE POLICY org_member_select_tasks ON public.tasks
  FOR SELECT USING (public.regapro_is_org_member(org_id));

CREATE POLICY task_manage ON public.tasks
  FOR ALL USING (public.regapro_has_permission(org_id, 'task:manage'))
  WITH CHECK (public.regapro_has_permission(org_id, 'task:manage'));

CREATE POLICY org_member_select_knowledge ON public.knowledge_documents
  FOR SELECT USING (public.regapro_is_org_member(org_id));

CREATE POLICY knowledge_write ON public.knowledge_documents
  FOR INSERT WITH CHECK (public.regapro_has_permission(org_id, 'knowledge:write'));

CREATE POLICY org_member_select_research ON public.research_runs
  FOR SELECT USING (public.regapro_is_org_member(org_id));

CREATE POLICY research_run ON public.research_runs
  FOR INSERT WITH CHECK (public.regapro_has_permission(org_id, 'research:run'));

CREATE POLICY own_profile ON public.profiles
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY own_notifications ON public.notifications
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY own_notification_prefs ON public.notification_preferences
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY audit_read ON public.audit_logs
  FOR SELECT USING (public.regapro_has_permission(org_id, 'audit:read'));

-- ---------------------------------------------------------------------------
-- Storage buckets (private) + policies
-- Buckets: knowledge-files, chat-attachments, artifacts, research-snapshots, user-avatars
-- Path convention: org/{org_id}/...
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public) VALUES
  ('knowledge-files', 'knowledge-files', false),
  ('chat-attachments', 'chat-attachments', false),
  ('artifacts', 'artifacts', false),
  ('research-snapshots', 'research-snapshots', false),
  ('user-avatars', 'user-avatars', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY storage_org_read ON storage.objects
  FOR SELECT
  USING (
    bucket_id IN ('knowledge-files', 'chat-attachments', 'artifacts', 'research-snapshots')
    AND public.regapro_is_org_member((split_part(name, '/', 2))::uuid)
  );

CREATE POLICY storage_org_insert ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id IN ('knowledge-files', 'chat-attachments', 'artifacts', 'research-snapshots')
    AND public.regapro_is_org_member((split_part(name, '/', 2))::uuid)
  );

CREATE POLICY storage_org_update ON storage.objects
  FOR UPDATE
  USING (
    bucket_id IN ('knowledge-files', 'chat-attachments', 'artifacts', 'research-snapshots')
    AND public.regapro_is_org_member((split_part(name, '/', 2))::uuid)
  )
  WITH CHECK (
    bucket_id IN ('knowledge-files', 'chat-attachments', 'artifacts', 'research-snapshots')
    AND public.regapro_is_org_member((split_part(name, '/', 2))::uuid)
  );

CREATE POLICY storage_org_delete ON storage.objects
  FOR DELETE
  USING (
    bucket_id IN ('knowledge-files', 'chat-attachments', 'artifacts', 'research-snapshots')
    AND public.regapro_is_org_member((split_part(name, '/', 2))::uuid)
  );

CREATE POLICY storage_avatar_read ON storage.objects
  FOR SELECT
  USING (bucket_id = 'user-avatars');

CREATE POLICY storage_avatar_own_write ON storage.objects
  FOR ALL
  USING (bucket_id = 'user-avatars' AND auth.uid()::text = split_part(name, '/', 1))
  WITH CHECK (bucket_id = 'user-avatars' AND auth.uid()::text = split_part(name, '/', 1));

-- ---------------------------------------------------------------------------
-- Additional RLS policies for org-scoped business tables
-- ---------------------------------------------------------------------------

CREATE POLICY org_member_select ON public.organizations
  FOR SELECT USING (public.regapro_is_org_member(id));

CREATE POLICY org_manage ON public.organizations
  FOR ALL USING (public.regapro_has_permission(id, 'organization:manage'))
  WITH CHECK (public.regapro_has_permission(id, 'organization:manage'));

CREATE POLICY org_member_select ON public.departments
  FOR SELECT USING (public.regapro_is_org_member(org_id));

CREATE POLICY org_member_select ON public.organization_memberships
  FOR SELECT USING (public.regapro_is_org_member(org_id));

CREATE POLICY member_manage ON public.organization_memberships
  FOR ALL USING (public.regapro_has_permission(org_id, 'member:manage'))
  WITH CHECK (public.regapro_has_permission(org_id, 'member:manage'));

CREATE POLICY org_member_select ON public.organization_invitations
  FOR SELECT USING (public.regapro_is_org_member(org_id));

CREATE POLICY org_member_select ON public.project_members
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND public.regapro_is_org_member(p.org_id)
    )
  );

CREATE POLICY org_member_select ON public.chat_threads
  FOR SELECT USING (public.regapro_is_org_member(org_id));

CREATE POLICY org_member_select ON public.chat_participants
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.chat_threads t
      WHERE t.id = thread_id AND public.regapro_is_org_member(t.org_id)
    )
  );

CREATE POLICY org_member_select ON public.chat_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.chat_threads t
      WHERE t.id = thread_id AND public.regapro_is_org_member(t.org_id)
    )
  );

CREATE POLICY org_member_select ON public.message_citations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.chat_messages m
      JOIN public.chat_threads t ON t.id = m.thread_id
      WHERE m.id = message_id AND public.regapro_is_org_member(t.org_id)
    )
  );

CREATE POLICY org_member_select ON public.message_attachments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.chat_messages m
      JOIN public.chat_threads t ON t.id = m.thread_id
      WHERE m.id = message_id AND public.regapro_is_org_member(t.org_id)
    )
  );

CREATE POLICY org_member_select ON public.task_reminders
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.tasks tk
      WHERE tk.id = task_id AND public.regapro_is_org_member(tk.org_id)
    )
  );

CREATE POLICY org_member_select ON public.task_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.tasks tk
      WHERE tk.id = task_id AND public.regapro_is_org_member(tk.org_id)
    )
  );

CREATE POLICY org_member_select ON public.notification_deliveries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.id = notification_id AND n.user_id = auth.uid()
    )
  );

CREATE POLICY org_member_select ON public.memory_items
  FOR SELECT USING (public.regapro_is_org_member(org_id));

CREATE POLICY org_member_select ON public.knowledge_sources
  FOR SELECT USING (public.regapro_is_org_member(org_id));

CREATE POLICY org_member_select ON public.knowledge_document_versions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.knowledge_documents d
      WHERE d.id = document_id AND public.regapro_is_org_member(d.org_id)
    )
  );

CREATE POLICY org_member_select ON public.knowledge_chunks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.knowledge_document_versions v
      JOIN public.knowledge_documents d ON d.id = v.document_id
      WHERE v.id = document_version_id AND public.regapro_is_org_member(d.org_id)
    )
  );

CREATE POLICY org_member_select ON public.knowledge_facts
  FOR SELECT USING (public.regapro_is_org_member(org_id));

CREATE POLICY org_member_select ON public.knowledge_revisions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.knowledge_documents d
      WHERE d.id = document_id AND public.regapro_is_org_member(d.org_id)
    )
  );

CREATE POLICY org_member_select ON public.knowledge_approvals
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.knowledge_documents d
      WHERE d.id = document_id AND public.regapro_is_org_member(d.org_id)
    )
  );

CREATE POLICY org_member_select ON public.research_queries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.research_runs r
      WHERE r.id = run_id AND public.regapro_is_org_member(r.org_id)
    )
  );

CREATE POLICY org_member_select ON public.research_sources
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.research_runs r
      WHERE r.id = run_id AND public.regapro_is_org_member(r.org_id)
    )
  );

CREATE POLICY org_member_select ON public.research_findings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.research_runs r
      WHERE r.id = run_id AND public.regapro_is_org_member(r.org_id)
    )
  );

CREATE POLICY org_member_select ON public.research_jobs
  FOR SELECT USING (public.regapro_is_org_member(org_id));

CREATE POLICY org_member_select ON public.prompt_profiles
  FOR SELECT USING (public.regapro_is_org_member(org_id));

CREATE POLICY org_member_select ON public.generated_prompts
  FOR SELECT USING (public.regapro_is_org_member(org_id));

CREATE POLICY org_member_select ON public.prompt_execution_results
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.generated_prompts gp
      WHERE gp.id = prompt_id AND public.regapro_is_org_member(gp.org_id)
    )
  );

CREATE POLICY org_member_select ON public.artifacts
  FOR SELECT USING (public.regapro_is_org_member(org_id));

CREATE POLICY org_member_select ON public.artifact_versions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.artifacts a
      WHERE a.id = artifact_id AND public.regapro_is_org_member(a.org_id)
    )
  );

CREATE POLICY org_member_select ON public.artifact_jobs
  FOR SELECT USING (public.regapro_is_org_member(org_id));

CREATE POLICY org_member_select ON public.citations
  FOR SELECT USING (public.regapro_is_org_member(org_id));

CREATE POLICY org_member_select ON public.tool_executions
  FOR SELECT USING (public.regapro_is_org_member(org_id));

CREATE POLICY org_member_select ON public.user_feedback
  FOR SELECT USING (public.regapro_is_org_member(org_id));

CREATE POLICY org_member_select ON public.file_objects
  FOR SELECT USING (public.regapro_is_org_member(org_id));

CREATE POLICY org_member_select ON public.roles
  FOR SELECT USING (org_id IS NULL OR public.regapro_is_org_member(org_id));

CREATE POLICY org_member_select ON public.permissions
  FOR SELECT USING (true);

CREATE POLICY org_member_select ON public.role_permissions
  FOR SELECT USING (true);

CREATE POLICY org_member_select ON public.membership_roles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.organization_memberships om
      WHERE om.id = membership_id AND public.regapro_is_org_member(om.org_id)
    )
  );
