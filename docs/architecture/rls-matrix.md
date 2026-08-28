# RLS Matrix / RLS マトリクス

Supabase Row-Level Security ポリシー一覧。すべてのテナントスコープテーブルで RLS を有効化する。

## Helper Functions / ヘルパー関数

```sql
-- 現在のユーザーの org_id 一覧
CREATE OR REPLACE FUNCTION auth_org_ids()
RETURNS SETOF UUID AS $$
  SELECT org_id FROM members WHERE user_id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 現在のユーザーの role
CREATE OR REPLACE FUNCTION auth_member_role(p_org_id UUID)
RETURNS TEXT AS $$
  SELECT role FROM members
  WHERE user_id = auth.uid() AND org_id = p_org_id
  LIMIT 1
$$ LANGUAGE sql SECURITY DEFINER STABLE;
```

## Policy Matrix / ポリシーマトリクス

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| organizations | member of org | authenticated (create) | owner, admin | owner |
| members | member of org | owner, admin | owner, admin | owner, admin |
| customers | member of org | member+ | member+ | manager+ |
| projects | member of org | member+ | member+ | manager+ |
| tasks | member of org | member+ | member+ (assignee or manager+) | manager+ |
| research_sessions | member of org | member+ | creator or manager+ | manager+ |
| research_sources | member of org | system/worker | member+ | manager+ |
| artifacts | member of org | member+ | member+ (creator or manager+) | manager+ |
| audit_logs | admin+ | system only | — | — |
| coding_devices | owner user | owner user | owner user | owner/admin |
| coding_workspaces | owner user | owner user | owner user | owner/admin |
| coding_runs | owner user | owner user | owner user | — |
| coding_commands | device owner | system/agent via app | — | — |
| coding_approvals | owner user | owner user | owner user | — |
| coding_audit_events | admin+ | system only | — | — |

**Role hierarchy:** owner > admin > manager > member > viewer

| Symbol | Meaning |
|---|---|
| member+ | member, manager, admin, owner |
| manager+ | manager, admin, owner |
| admin+ | admin, owner |

## Example Policies / ポリシー例

### projects

```sql
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "projects_select" ON projects
  FOR SELECT USING (org_id IN (SELECT auth_org_ids()));

CREATE POLICY "projects_insert" ON projects
  FOR INSERT WITH CHECK (
    org_id IN (SELECT auth_org_ids())
    AND auth_member_role(org_id) IN ('owner','admin','manager','member')
  );

CREATE POLICY "projects_update" ON projects
  FOR UPDATE USING (
    org_id IN (SELECT auth_org_ids())
    AND auth_member_role(org_id) IN ('owner','admin','manager','member')
  );

CREATE POLICY "projects_delete" ON projects
  FOR DELETE USING (
    org_id IN (SELECT auth_org_ids())
    AND auth_member_role(org_id) IN ('owner','admin','manager')
  );
```

### research_sources (worker insert)

Research worker uses `service_role` to insert sources. User JWT cannot insert directly.

```sql
CREATE POLICY "sources_select" ON research_sources
  FOR SELECT USING (org_id IN (SELECT auth_org_ids()));

-- INSERT/UPDATE via service_role only (no user policy)
```

## Viewer Restrictions / 閲覧者制限

`viewer` role: SELECT only on all org-scoped tables. No INSERT, UPDATE, DELETE.

## Service Role Usage / サービスロール

| Process | Key | Tables |
|---|---|---|
| Research Worker | service_role | research_sources (INSERT), research_sessions (UPDATE) |
| Cron jobs | service_role | audit_logs (INSERT) |
| Migration | service_role | all (DDL) |

**Never** expose service_role to client or Next.js client components.

## Testing RLS / RLS テスト

```sql
-- Test as specific user
SET request.jwt.claims = '{"sub": "user-uuid-here"}';
SELECT * FROM projects; -- should only see own org
```

Automated: Supabase test helpers or integration tests with test users.

## Related / 関連

- [Permission Matrix](./permission-matrix.md)
- [ADR 009: Supabase RLS](../adr/009-supabase-rls.md)
