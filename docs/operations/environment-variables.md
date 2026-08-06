# Environment Variables / 環境変数

Regapro AI の環境変数リファレンス。**秘密情報はクライアントに公開しない。**

## Quick Reference / クイックリファレンス

| Variable | Required | Scope | Description |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Client | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Client | Supabase anon key (RLS protected) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Server only | Service role — workers/migrations |
| `SEARXNG_URL` | ✅ | Server only | SearXNG instance URL |
| `RESEARCH_FALLBACK_PROVIDER` | ❌ | Server only | `tavily` or `exa` (not firecrawl) |
| `TAVILY_API_KEY` | ❌ | Server only | If fallback = tavily |
| `EXA_API_KEY` | ❌ | Server only | If fallback = exa |
| `OPENAI_API_KEY` | ❌ | Server only | External LLM (optional) |
| `ANTHROPIC_API_KEY` | ❌ | Server only | External LLM (optional) |
| `CRON_SECRET` | ❌ | Server only | Cron endpoint auth |
| `NODE_ENV` | auto | Both | development / production |

## Client-Safe (NEXT_PUBLIC_) / クライアント安全

```env
# .env.local (apps/web)
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

**Never prefix secrets with `NEXT_PUBLIC_`.**

## Server-Only / サーバーのみ

```env
# .env.local (apps/web) — NOT exposed to browser
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SEARXNG_URL=http://localhost:8080
RESEARCH_FALLBACK_PROVIDER=tavily
TAVILY_API_KEY=tvly-...
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
CRON_SECRET=random-secret-here
```

## Research Worker / 調査ワーカー

```env
# services/research-worker/.env
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SEARXNG_URL=http://localhost:8080
RESEARCH_FALLBACK_PROVIDER=exa
EXA_API_KEY=...
POLL_INTERVAL_MS=5000
```

## NOT Used / 使用しない

| Variable | Reason |
|---|---|
| `FIRECRAWL_API_KEY` | Firecrawl is interface-only, no API calls |
| Any Firecrawl-related env | Policy: no Firecrawl integration |

## Environment Files / 環境ファイル

```
apps/web/.env.local          # Development (gitignored)
apps/web/.env.example        # Template (committed)
services/research-worker/.env.local
services/research-worker/.env.example
```

## Validation / バリデーション

Application startup validates required vars:

```typescript
const required = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required env: ${key}`);
}
```

Server-only vars validated in API routes / workers, not at client build.

## Related / 関連

- [Supabase Setup](./supabase-setup.md)
- [Deployment](./deployment.md)
- [Data Security](../.cursor/rules/data-security.mdc)
