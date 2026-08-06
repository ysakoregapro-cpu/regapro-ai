# ADR 006: Research Worker Separation

## Status

Accepted

## Date

2026-02-01

## Context / 背景

調査（Research）処理は SearXNG への HTTP リクエスト、結果の正規化、DB への保存を含み、数秒〜数十秒かかる。Next.js Server Actions / API Routes 内で同期実行すると:

- リクエストタイムアウト
- サーバーレス関数の実行時間制限
- ユーザー体験の劣化（長時間ローディング）

## Decision / 決定

**Research Worker** を独立サービスとして分離する。

```
Browser → API → ResearchService.createSession()
  → Enqueue job → Return session ID immediately

Research Worker (services/research-worker/)
  → Poll job queue
  → SearXNGProvider.search()
  → Store sources (service_role)
  → Update session status
  → Client notified via Realtime
```

### Worker Properties

| Property | Value |
|---|---|
| Location | `services/research-worker/` |
| Deployment | Long-running process (Railway, Fly.io) |
| Auth | Supabase service_role key |
| Queue | PostgreSQL table or Supabase Edge Function queue |
| Provider | SearXNG primary; fallback interfaces only |

### Job Queue Schema

```sql
CREATE TABLE research_jobs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES research_sessions(id),
  status      TEXT DEFAULT 'queued',
  attempts    INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

## Alternatives Considered / 検討した代替案

| Option | Verdict |
|---|---|
| Sync in API route | Rejected — timeout, poor UX |
| Supabase Edge Function | Considered — 150s limit may be tight |
| External queue (Redis/BullMQ) | Rejected — infra complexity for v1 |
| **Dedicated worker + PG queue** | **Selected** |

## Consequences / 結果

### Positive

- Non-blocking API responses
- Retry logic in worker (3 attempts)
- Independent scaling of research capacity
- Clean separation of concerns

### Negative

- Additional service to deploy and monitor
- Eventual consistency (user waits for Realtime update)
- service_role key management for worker

## Related ADRs

- [002: Provider Architecture](./002-provider-architecture.md)
- [005: Knowledge-Answer Separation](./005-knowledge-answer-separation.md)
