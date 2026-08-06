# ADR 003: External AI Optional

## Status

Accepted

## Date

2026-01-22

## Context / 背景

多くの AI プロダクトは外部 LLM API（OpenAI, Anthropic）を必須とする。Regapro AI のターゲット（日本 B2B）では:

- データを外部に送信したくない組織がある
- API コストを避けたい中小企業がある
- オフライン/限定的環境での利用需求

Regapro AI は **ビジネス OS** として、AI なしでも基本機能（案件、タスク、調査、成果物管理）が動作すべき。

## Decision / 決定

**外部 AI API はオプション** とする。

### Capability Matrix

| Feature | Without External AI | With External AI |
|---|---|---|
| 案件/顧客/タスク CRUD | ✅ | ✅ |
| 調査 (SearXNG) | ✅ | ✅ |
| 成果物手動作成 | ✅ | ✅ |
| 成果物 AI 下書き | ⚠️ Browser local only | ✅ |
| インライン AI 提案 | ⚠️ Browser local only | ✅ |
| ソース要約 | ❌ | ✅ |

### Default Configuration

```typescript
const defaultLLMConfig = {
  external: null,        // No external API
  browserLocal: false,   // User must opt-in
};
```

Admin enables external AI in Settings → requires API key (server-side only).

## Alternatives Considered / 検討した代替案

| Option | Verdict |
|---|---|
| External AI required | Rejected — excludes privacy-conscious orgs |
| No AI at all | Rejected — AI assist is core value when opted-in |
| External AI default, local optional | Rejected — wrong default for JP B2B |
| **External optional, local optional** | **Selected** |

## Consequences / 結果

### Positive

- Broader market (privacy-conscious orgs)
- Lower barrier to entry (no API key needed)
- Clear upsell path to external AI

### Negative

- Two code paths for AI features (local vs external)
- Browser local LLM quality lower than cloud

## Related ADRs

- [004: Browser Local LLM](./004-browser-local-llm.md)
- [002: Provider Architecture](./002-provider-architecture.md)
