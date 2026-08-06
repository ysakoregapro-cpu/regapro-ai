# Database Schema / データベーススキーマ

Supabase (PostgreSQL) スキーマ定義。すべてのテナントスコープテーブルに RLS を適用。

## Tables / テーブル

### organizations

```sql
CREATE TABLE organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  settings    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
```

### members

```sql
CREATE TABLE members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('owner','admin','manager','member','viewer')),
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (org_id, user_id)
);
```

### customers

```sql
CREATE TABLE customers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  contact_info JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
```

### projects

```sql
CREATE TABLE projects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  stage       TEXT NOT NULL DEFAULT 'lead'
              CHECK (stage IN ('lead','proposal','negotiation','won','lost')),
  owner_id    UUID REFERENCES members(id) ON DELETE SET NULL,
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
```

### tasks

```sql
CREATE TABLE tasks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  assignee_id UUID REFERENCES members(id) ON DELETE SET NULL,
  due_date    DATE,
  status      TEXT NOT NULL DEFAULT 'todo'
              CHECK (status IN ('todo','in_progress','done','cancelled')),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
```

### research_sessions

```sql
CREATE TABLE research_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  query       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','running','completed','failed')),
  created_by  UUID NOT NULL REFERENCES members(id),
  error_message TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);
```

### research_sources

```sql
CREATE TABLE research_sources (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES research_sessions(id) ON DELETE CASCADE,
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  title       TEXT,
  snippet     TEXT,
  pinned      BOOLEAN DEFAULT false,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

### artifacts

```sql
CREATE TABLE artifacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type        TEXT NOT NULL
              CHECK (type IN ('proposal','minutes','report','memo','custom')),
  title       TEXT NOT NULL,
  content     JSONB NOT NULL DEFAULT '{}',
  version     INTEGER NOT NULL DEFAULT 1,
  status      TEXT NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft','review','approved','published')),
  created_by  UUID NOT NULL REFERENCES members(id),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
```

### audit_logs

```sql
CREATE TABLE audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id    UUID REFERENCES members(id),
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   UUID,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

## Indexes / インデックス

```sql
CREATE INDEX idx_members_org ON members(org_id);
CREATE INDEX idx_members_user ON members(user_id);
CREATE INDEX idx_projects_org ON projects(org_id);
CREATE INDEX idx_projects_customer ON projects(customer_id);
CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX idx_tasks_due ON tasks(due_date) WHERE status != 'done';
CREATE INDEX idx_research_sessions_project ON research_sessions(project_id);
CREATE INDEX idx_research_sources_session ON research_sources(session_id);
CREATE INDEX idx_artifacts_project ON artifacts(project_id);
CREATE INDEX idx_audit_logs_org ON audit_logs(org_id, created_at DESC);
```

## RLS / 行レベルセキュリティ

All tables except `organizations` (created via service): **RLS enabled**.

Pattern:

```sql
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can read projects"
  ON projects FOR SELECT
  USING (org_id IN (SELECT org_id FROM members WHERE user_id = auth.uid()));
```

Full matrix: [RLS Matrix](./rls-matrix.md).

## Related / 関連

- [Domain Model](./domain-model.md)
- [RLS Matrix](./rls-matrix.md)
- [Migration Operation](../operations/migration-operation.md)
