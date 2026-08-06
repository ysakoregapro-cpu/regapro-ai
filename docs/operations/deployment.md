# Deployment / デプロイメント

Regapro AI のデプロイメント手順と環境構成。

## Environments / 環境

| Environment | Purpose | URL |
|---|---|---|
| local | Development | `http://localhost:3000` |
| staging | Pre-production testing | `https://staging.regapro.ai` |
| production | Live | `https://app.regapro.ai` |

## Architecture / デプロイ構成

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Vercel    │────▶│   Supabase   │     │   SearXNG   │
│  (Next.js)  │     │  (DB/Auth)   │     │  (Research) │
└─────────────┘     └──────────────┘     └─────────────┘
       │                                       ▲
       │            ┌──────────────┐            │
       └───────────▶│ Research     │────────────┘
                    │ Worker       │
                    │ (Railway/Fly)│
                    └──────────────┘
```

## Pre-Deploy Checklist / デプロイ前チェック

- [ ] `npm run check` passes (typecheck, lint, test, build)
- [ ] Migrations tested locally
- [ ] Environment variables configured in hosting platform
- [ ] No secrets in client bundle (verify build output)
- [ ] RLS policies verified

## Vercel Deployment (Web App) / Vercel デプロイ

### Initial Setup / 初回

```bash
# Install Vercel CLI
npm i -g vercel

# Link project
cd apps/web
vercel link

# Set environment variables
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add SEARXNG_URL
vercel env add CRON_SECRET
# ... other server-only vars
```

### Deploy / デプロイ

```bash
# Staging
vercel

# Production
vercel --prod
```

### vercel.json

```json
{
  "buildCommand": "cd ../.. && npm run build --workspace=@regapro/web",
  "outputDirectory": "apps/web/.next",
  "framework": "nextjs",
  "crons": [
    { "path": "/api/cron/cleanup", "schedule": "0 */6 * * *" }
  ]
}
```

## Research Worker Deployment / 調査ワーカー

Deploy as long-running process (not serverless):

```bash
# Railway example
railway init
railway up --service research-worker
```

Environment: see [Environment Variables](./environment-variables.md) (worker section).

## Database Migrations / DB マイグレーション

Deploy migrations **before** application code:

```bash
npx supabase link --project-ref <production-ref>
npx supabase db push
# Then deploy application
vercel --prod
```

## Post-Deploy Verification / デプロイ後確認

```bash
# Health check
curl -s https://app.regapro.ai/api/health

# Auth flow (manual)
# 1. Login
# 2. Create project
# 3. Start research (if SearXNG configured)
# 4. Create artifact draft
```

## Rollback / ロールバック

### Application / アプリケーション

```bash
# Vercel: revert to previous deployment
vercel rollback
```

### Database / データベース

See [Backup and Recovery](./backup-and-recovery.md) — migrations are not auto-reversible.

## CI/CD Pipeline / CI/CD

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "24" }
      - run: npm ci
      - run: npm run check

  migrate:
    needs: check
    runs-on: ubuntu-latest
    steps:
      - run: npx supabase db push
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}

  deploy:
    needs: migrate
    runs-on: ubuntu-latest
    steps:
      - run: vercel --prod --token=${{ secrets.VERCEL_TOKEN }}
```

## Related / 関連

- [Environment Variables](./environment-variables.md)
- [Bootstrap](./bootstrap.md)
- [Incident Response](./incident-response.md)
