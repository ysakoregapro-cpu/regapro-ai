# Research Pipeline / 調査パイプライン

Regapro AI の調査（Research）処理パイプライン。SearXNG をプライマリとし、フォールバック Provider はインターフェースのみ。

## Flow / フロー

```
┌──────────┐    ┌──────────────┐    ┌─────────────────┐
│  Browser │───▶│ API Route    │───▶│ ResearchService │
│  (UI)    │    │ (server)     │    │ (Application)   │
└──────────┘    └──────────────┘    └────────┬────────┘
                                               │
                                    ┌──────────▼──────────┐
                                    │ Create session (DB) │
                                    │ status: pending     │
                                    └──────────┬──────────┘
                                               │
                                    ┌──────────▼──────────┐
                                    │ Enqueue job         │
                                    └──────────┬──────────┘
                                               │
┌──────────────────────────────────────────────▼──────────┐
│              Research Worker (services/)                   │
│  1. Pick job                                               │
│  2. status → running                                       │
│  3. SearXNGProvider.search(query)                          │
│  4. Store research_sources                                 │
│  5. status → completed | failed                            │
│  6. Notify (Realtime / webhook)                            │
└───────────────────────────────────────────────────────────┘
```

## Components / コンポーネント

| Component | Location | Responsibility |
|---|---|---|
| `ResearchService` | packages/application | Orchestrate session lifecycle |
| `ResearchRepository` | packages/infrastructure | DB CRUD |
| `SearXNGProvider` | packages/infrastructure | Primary search |
| `ResearchWorker` | services/research-worker | Async job processing |
| `JobQueue` | Supabase (pg_cron + table) or external | Job dispatch |

## SearXNG Integration / SearXNG 連携

```typescript
class SearXNGProvider implements ResearchProvider {
  constructor(private baseUrl: string) {}

  async search(query: string, options?: ResearchOptions): Promise<ResearchResult[]> {
    const url = new URL("/search", this.baseUrl);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("categories", "general");

    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) throw new ResearchProviderError("searxng", response.status);

    const data = await response.json();
    return data.results.map(normalizeResult);
  }

  name = "searxng";
}
```

## Fallback Providers / フォールバック

| Provider | Status | Notes |
|---|---|---|
| Tavily | Interface defined | Implement when needed |
| Exa | Interface defined | Implement when needed |
| Firecrawl | **Interface only** | NO install, NO API calls |

Selection via `RESEARCH_FALLBACK_PROVIDER` env var. If primary fails and fallback configured, retry with fallback.

## Job Model / ジョブモデル

```typescript
interface ResearchJob {
  id: string;
  sessionId: string;
  orgId: string;
  query: string;
  status: "queued" | "processing" | "completed" | "failed";
  attempts: number;
  maxAttempts: 3;
  createdAt: Date;
}
```

## Error Handling / エラー処理

| Error | User Message (JA) | Retry |
|---|---|---|
| SearXNG timeout | 調査がタイムアウトしました。もう一度お試しください。 | Auto (3x) |
| SearXNG down | 調査サービスに接続できませんでした。 | Auto → fallback |
| No results | 該当するソースが見つかりませんでした。 | No |
| All providers fail | 調査に失敗しました。しばらくしてから再試行してください。 | Manual |

**Never show provider names to users.**

## Realtime Updates / リアルタイム更新

```typescript
// Client subscribes to session status changes
supabase
  .channel(`research:${sessionId}`)
  .on("postgres_changes", {
    event: "UPDATE",
    schema: "public",
    table: "research_sessions",
    filter: `id=eq.${sessionId}`,
  }, handleStatusChange)
  .subscribe();
```

## Security / セキュリティ

- Research Worker uses `service_role` for source INSERT
- User JWT cannot insert sources directly (RLS)
- SearXNG URL is server-side env only
- Query content is org-scoped and RLS-protected

## Related / 関連

- [Provider Architecture](./provider-architecture.md)
- [ADR 006: Research Worker Separation](../adr/006-research-worker-separation.md)
