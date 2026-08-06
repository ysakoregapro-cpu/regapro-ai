# ADR 009: Supabase RLS

## Status

Accepted

## Date

2026-02-10

## Context / 背景

Regapro AI はマルチテナント B2B SaaS。組織（Organization）ごとにデータを完全分離する必要がある。クライアントサイドフィルタリングのみでは不十分 — データベースレベルでの強制が必須。

## Decision / 決定

**Supabase Row-Level Security (RLS)** をすべてのテナントスコープテーブルに適用する。

### Principles

1. **Every tenant table has RLS enabled** — no exceptions
2. **Default deny** — no policy = no access
3. **Three-layer enforcement:** RLS (DB) + Application Service (code) + UI (hide actions)
4. **service_role** used only by workers and migrations — never in client

### Policy Pattern

```sql
ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;

CREATE POLICY "{table}_select" ON {table}
  FOR SELECT USING (org_id IN (SELECT auth_org_ids()));

CREATE POLICY "{table}_insert" ON {table}
  FOR INSERT WITH CHECK (
    org_id IN (SELECT auth_org_ids())
    AND auth_member_role(org_id) IN ('owner','admin','manager','member')
  );
```

### Role Hierarchy

```
owner > admin > manager > member > viewer
```

Viewer: SELECT only. Member+: CRUD on work entities. Admin+: member management.

### Worker Exception

Research Worker uses `service_role` to INSERT into `research_sources` (user JWT cannot insert sources directly).

## Alternatives Considered / 検討した代替案

| Option | Verdict |
|---|---|
| Application-level filtering only | Rejected — bypassable |
| Separate DB per tenant | Rejected — ops complexity |
| Schema-per-tenant | Rejected — migration complexity |
| **Shared DB + RLS** | **Selected** |
| Custom auth middleware | Rejected — Supabase RLS is battle-tested |

## Consequences / 結果

### Positive

- Database-enforced isolation (defense in depth)
- Supabase native — no custom auth layer
- Works with Realtime subscriptions
- Audit-friendly

### Negative

- Complex policies for role-based access
- service_role management for workers
- RLS debugging can be tricky (use `auth.uid()` helpers)
- Performance: policy subqueries on every query (mitigated by indexes)

## Testing

- Integration tests with multiple test users
- CI check: all public tables have RLS enabled
- Manual: `SET request.jwt.claims` for policy verification

## Related

- [RLS Matrix](../architecture/rls-matrix.md)
- [Permission Matrix](../architecture/permission-matrix.md)
