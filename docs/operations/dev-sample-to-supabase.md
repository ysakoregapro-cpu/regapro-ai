# Dev Sample to Supabase / 開発サンプルデータ

ローカル開発用のサンプルデータを Supabase に投入する手順。

## Overview / 概要

`supabase/seed.sql` に開発用サンプルデータを定義。組織、メンバー、顧客、案件、タスク、調査、成果物の一式を含む。

## Seed Data Contents / シード内容

| Entity | Count | Notes |
|---|---|---|
| Organization | 1 | 「サンプル株式会社」 |
| Members | 3 | owner, manager, member |
| Customers | 3 | 日本企業名 |
| Projects | 4 | Various stages |
| Tasks | 12 | Mix of statuses and due dates |
| Research Sessions | 2 | 1 completed, 1 pending |
| Research Sources | 8 | From completed session |
| Artifacts | 2 | 1 draft proposal, 1 published minutes |

## Running Seed / シード実行

### Full Reset + Seed / フルリセット

```bash
npx supabase db reset
# Runs all migrations + seed.sql
```

### Seed Only (after migrations) / シードのみ

```bash
npx supabase db seed
# or manually:
psql -h localhost -p 54322 -U postgres -d postgres -f supabase/seed.sql
```

## Sample Users / サンプルユーザー

Created via Supabase Auth + seed.sql members table:

| Email | Password | Role | Persona |
|---|---|---|---|
| `owner@sample.co.jp` | `sample1234` | owner | 山本（管理者） |
| `manager@sample.co.jp` | `sample1234` | manager | 田中（営業マネージャー） |
| `member@sample.co.jp` | `sample1234` | member | 佐藤（フィールドセールス） |

**Local development only.** Never use these credentials in production.

## Sample Seed SQL Structure / シード SQL 構造

```sql
-- supabase/seed.sql (excerpt)

-- Organization
INSERT INTO organizations (id, name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'サンプル株式会社');

-- Customers
INSERT INTO customers (id, org_id, name, contact_info) VALUES
  ('22222222-2222-2222-2222-222222222221', '11111111-1111-1111-1111-111111111111',
   '東京テック株式会社', '{"email": "info@tokyo-tech.co.jp"}'),
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
   '大阪商事株式会社', '{"email": "contact@osaka-shoji.co.jp"}');

-- Projects
INSERT INTO projects (id, org_id, customer_id, name, stage, owner_id) VALUES
  ('33333333-3333-3333-3333-333333333331', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222221', '東京テック DX 提案', 'proposal', ...);

-- Tasks, research, artifacts follow same pattern
```

## Auth User Creation / 認証ユーザー作成

Seed script should also create auth users. Use Supabase Admin API or seed helper:

```typescript
// scripts/seed-auth.ts
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const users = [
  { email: "owner@sample.co.jp", password: "sample1234" },
  { email: "manager@sample.co.jp", password: "sample1234" },
  { email: "member@sample.co.jp", password: "sample1234" },
];

for (const user of users) {
  await supabase.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
  });
}
```

Run: `npx tsx scripts/seed-auth.ts`

## Verification / 確認

After seeding:

```bash
# Login as manager@sample.co.jp
# Navigate to:
# - 今日 → should see tasks
# - 案件 → should see 4 projects
# - 案件詳細 → 調査タブ → 1 completed session with sources
# - 成果物 → 1 draft proposal
```

## Customizing Sample Data / カスタマイズ

To add your own sample data:

1. Edit `supabase/seed.sql`
2. Maintain UUID consistency across foreign keys
3. Run `npx supabase db reset`
4. Verify via UI

## Related / 関連

- [Bootstrap](./bootstrap.md)
- [Supabase Setup](./supabase-setup.md)
- [User Personas](../product/user-personas.md)
