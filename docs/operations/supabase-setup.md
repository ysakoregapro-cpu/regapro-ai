# Supabase Setup / Supabase セットアップ

Regapro AI の Supabase プロジェクト初期設定手順。

## Prerequisites / 前提条件

- [Supabase CLI](https://supabase.com/docs/guides/cli) installed
- Node.js >= 24
- Docker (for local Supabase)

## Local Development / ローカル開発

### 1. Initialize / 初期化

```bash
# From repo root
npx supabase init   # if not already initialized
npx supabase start
```

Local Supabase starts:
- API: `http://localhost:54321`
- Studio: `http://localhost:54323`
- DB: `postgresql://postgres:postgres@localhost:54322/postgres`

### 2. Environment / 環境変数

```bash
cp apps/web/.env.example apps/web/.env.local
```

Fill from `supabase status`:

```env
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from supabase status>
SUPABASE_SERVICE_ROLE_KEY=<service_role key from supabase status>
```

### 3. Run Migrations / マイグレーション

```bash
npx supabase db push
# or
npx supabase migration up
```

See [Migration Operation](./migration-operation.md).

### 4. Seed Data (optional) / シード

```bash
npx supabase db seed
```

See [Dev Sample to Supabase](./dev-sample-to-supabase.md).

## Production Setup / 本番セットアップ

### 1. Create Project / プロジェクト作成

1. [Supabase Dashboard](https://supabase.com/dashboard) → New Project
2. Choose region (Tokyo recommended for JP users)
3. Save database password securely

### 2. Configure Auth / 認証設定

Dashboard → Authentication → Providers:

- Email: enabled
- Google OAuth: optional (configure redirect URLs)
- Site URL: `https://your-domain.com`
- Redirect URLs: `https://your-domain.com/auth/callback`

### 3. Run Migrations / マイグレーション

```bash
npx supabase link --project-ref <project-ref>
npx supabase db push
```

### 4. Enable RLS / RLS 有効化

All tenant tables must have RLS. Verify:

```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public';
```

See [RLS Matrix](../architecture/rls-matrix.md).

### 5. Storage Buckets / ストレージ

```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('artifacts', 'artifacts', false);

-- RLS policies for artifact file uploads
```

## SearXNG (Research) / SearXNG

SearXNG runs separately — not part of Supabase.

```bash
# Docker example
docker run -d -p 8080:8080 searxng/searxng
```

Set `SEARXNG_URL=http://localhost:8080` in env.

## Health Check / ヘルスチェック

```bash
# Supabase
curl http://localhost:54321/rest/v1/ -H "apikey: <anon key>"

# SearXNG
curl "http://localhost:8080/search?q=test&format=json"
```

## Related / 関連

- [Environment Variables](./environment-variables.md)
- [Bootstrap](./bootstrap.md)
- [Migration Operation](./migration-operation.md)
