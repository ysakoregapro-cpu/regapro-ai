# Migration Operation / マイグレーション運用

Supabase データベースマイグレーションの作成・適用・ロールバック手順。

## Directory Structure / ディレクトリ構造

```
supabase/
├── migrations/
│   ├── 20260101000000_initial_schema.sql
│   ├── 20260102000000_add_audit_logs.sql
│   └── ...
├── seed.sql
└── config.toml
```

## Creating Migrations / マイグレーション作成

### New Migration / 新規

```bash
npx supabase migration new <descriptive_name>
# Creates: supabase/migrations/<timestamp>_<descriptive_name>.sql
```

### From Diff / 差分から

```bash
# After manual changes in local Studio
npx supabase db diff -f <descriptive_name>
```

## Migration Rules / マイグレーションルール

1. **Always enable RLS** on new tenant-scoped tables
2. **Add indexes** for foreign keys and common query patterns
3. **Use CHECK constraints** for enum-like columns
4. **Include rollback comments** (manual — Supabase doesn't auto-rollback)
5. **Never modify** applied migrations — create new ones

### Template / テンプレート

```sql
-- Migration: add_notifications_table
-- Rollback: DROP TABLE IF EXISTS notifications;

CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message    TEXT NOT NULL,
  read       BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifications_select" ON notifications
  FOR SELECT USING (
    user_id = auth.uid()
    AND org_id IN (SELECT org_id FROM members WHERE user_id = auth.uid())
  );

CREATE INDEX idx_notifications_user ON notifications(user_id, read);
```

## Applying Migrations / 適用

### Local / ローカル

```bash
npx supabase migration up
# or reset (destructive):
npx supabase db reset
```

### Production / 本番

```bash
npx supabase link --project-ref <ref>
npx supabase db push
```

**Always test locally first.** Production migrations are irreversible without manual rollback SQL.

## CI Integration / CI 連携

```yaml
# .github/workflows/migrate.yml
- name: Run migrations
  run: npx supabase db push
  env:
    SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
    SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}
```

## Verification / 検証

After migration:

```bash
# Check tables
npx supabase db dump --schema public | head -50

# Check RLS
psql -c "SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public';"

# Run tests
npm run test
npm run typecheck
```

## Rollback / ロールバック

Supabase doesn't support automatic down migrations. For rollback:

1. Write reverse SQL manually
2. Create new migration with reverse changes
3. Apply via `db push`

For emergencies: restore from backup — see [Backup and Recovery](./backup-and-recovery.md).

## Related / 関連

- [Database Schema](../architecture/database-schema.md)
- [Supabase Setup](./supabase-setup.md)
