# Bootstrap / ブートストラップ

Regapro AI 開発環境の初回セットアップ手順。

## Prerequisites / 前提条件

| Tool | Version | Check |
|---|---|---|
| Node.js | >= 24 | `node -v` |
| npm | >= 10 | `npm -v` |
| Docker | latest | `docker -v` |
| Supabase CLI | latest | `npx supabase -v` |
| Git | latest | `git -v` |

## Quick Start (dev-sample default) / クイックスタート

```bash
# 1. Clone
git clone <repo-url> regapro-ai
cd regapro-ai

# 2. Install dependencies
npm install

# 3. Start Supabase (local)
npx supabase start

# 4. Configure environment
cp apps/web/.env.example apps/web/.env.local
# Fill values from `npx supabase status`

# 5. Run migrations
npx supabase db push

# 6. Seed sample data (optional)
npx supabase db seed

# 7. Start SearXNG (optional, for research)
docker run -d -p 8080:8080 --name searxng searxng/searxng
# Add to .env.local: SEARXNG_URL=http://localhost:8080

# 8. Start dev server
npm run dev
# → http://localhost:3000
```

## Workspace Scripts / ワークスペーススクリプト

| Command | Description |
|---|---|
| `npm run dev` | Start Next.js dev server (apps/web) |
| `npm run build` | Build all workspaces |
| `npm run lint` | Lint all workspaces |
| `npm run typecheck` | TypeScript check all workspaces |
| `npm run test` | Run tests all workspaces |
| `npm run check` | All gates: typecheck + lint + test + build |

## Verify Setup / セットアップ確認

```bash
# Quality gates
npm run check

# Supabase health
curl http://localhost:54321/rest/v1/ -H "apikey: <anon key>"

# App loads
curl -s http://localhost:3000 | head -5
```

## Optional: Research Worker / 調査ワーカー

```bash
cd services/research-worker
cp .env.example .env.local
# Fill Supabase + SearXNG vars
npm run dev
```

## Troubleshooting / トラブルシューティング

| Issue | Solution |
|---|---|
| `supabase start` fails | Ensure Docker is running |
| Port 3000 in use | `PORT=3001 npm run dev` |
| Type errors | `npm run typecheck` for details |
| Missing env vars | Check `apps/web/.env.local` against `.env.example` |

## Next Steps / 次のステップ

1. [Dev Sample to Supabase](./dev-sample-to-supabase.md) — load sample data
2. [Supabase Setup](./supabase-setup.md) — detailed Supabase config
3. [Product Definition](../product/product-definition.md) — understand the product

## Related / 関連

- [Environment Variables](./environment-variables.md)
- [Deployment](./deployment.md)
