# ADR 002: Provider Architecture

## Status

Accepted

## Date

2026-01-20

## Context / 背景

Regapro AI は複数の外部サービス（調査、LLM、ストレージ）に依存する。これらは変更・差し替え・テスト時モック化が必要。UI から直接呼び出すとテスト困難、秘密漏洩リスク、差し替え不可。

## Decision / 決定

**Provider Pattern** を採用し、Application Service 層からインターフェース経由で呼び出す。

```
UI → Application Service → Provider Interface → Concrete Provider
```

### Provider Categories

| Category | Interface | Primary | Fallback |
|---|---|---|---|
| Research | `ResearchProvider` | SearXNG | Tavily, Exa (interfaces) |
| LLM | `LLMProvider` | Browser Local | OpenAI, Anthropic |
| Storage | `StorageProvider` | Supabase Storage | — |

### Rules

1. UI **must not** call Provider directly
2. Provider names are internal — never shown in UI
3. Firecrawl: interface only, no API calls, no install
4. Provider selection via configuration, not code branching in UI

## Alternatives Considered / 検討した代替案

| Option | Verdict |
|---|---|
| Direct API calls in components | Rejected — no testability, secret exposure |
| Single provider hardcoded | Rejected — no flexibility |
| Plugin system with dynamic loading | Rejected — over-engineering for v1 |
| Provider Pattern with DI | **Selected** |

## Consequences / 結果

### Positive

- Easy mocking in tests
- Swap providers via config
- Clear layer boundaries
- Server-side only for external providers

### Negative

- Interface maintenance overhead
- Indirection adds complexity for simple calls

## Related ADRs

- [003: External AI Optional](./003-external-ai-optional.md)
- [006: Research Worker Separation](./006-research-worker-separation.md)
