# Provider Architecture / プロバイダー・アーキテクチャ

## Pattern / パターン

Regapro AI は **Provider Pattern** で外部依存を抽象化します。Application Service が Provider インターフェースを注入され、実装は設定で差し替え可能。

```
ApplicationService
  → ProviderInterface (contract)
    → ConcreteProvider (implementation)
```

**UI は Provider を直接呼ばない。** Application Service 経由のみ。

## Provider Categories / カテゴリ

### Research Providers / 調査プロバイダー

| Provider | Role | Status |
|---|---|---|
| `SearXNGProvider` | **Primary** | Active |
| `TavilyProvider` | Fallback interface | Interface only |
| `FirecrawlProvider` | Fallback interface | **Interface only — NO API calls, NO install** |
| `ExaProvider` | Fallback interface | Interface only |

```typescript
// packages/application/src/providers/research-provider.ts

interface ResearchProvider {
  search(query: string, options?: ResearchOptions): Promise<ResearchResult[]>;
  name: string; // internal only — never shown in UI
}

interface ResearchResult {
  url: string;
  title: string;
  snippet: string;
  score?: number;
}
```

**Selection logic:**

```
1. SearXNG (if configured and healthy)
2. Fallback provider (if configured via RESEARCH_FALLBACK_PROVIDER env)
3. Error — user sees "調査に失敗しました" (not provider name)
```

### LLM Providers / LLM プロバイダー

| Provider | Role | Location |
|---|---|---|
| `BrowserLocalLLMProvider` | Optional primary | Client (WebGPU/WASM) |
| `OpenAIProvider` | Optional external | Server |
| `AnthropicProvider` | Optional external | Server |
| `NoOpLLMProvider` | Default when none configured | — |

See [Browser Local LLM](./browser-local-llm.md) and [ADR 003](../adr/003-external-ai-optional.md).

### Storage Providers / ストレージ

| Provider | Role |
|---|---|
| `SupabaseStorageProvider` | Default — file attachments, exports |

## Configuration / 設定

```typescript
// Provider registry (server-side only)
interface ProviderConfig {
  research: {
    primary: "searxng";
    fallback?: "tavily" | "exa"; // never "firecrawl" in production
    searxngUrl: string;
  };
  llm: {
    external?: "openai" | "anthropic" | null;
    browserLocal?: boolean;
  };
}
```

Environment variables — see [Environment Variables](../operations/environment-variables.md).

## Error Handling / エラー処理

- Provider errors are caught at Application Service layer
- User sees domain-language messages
- Provider name, HTTP status, stack trace → server logs only

## Testing / テスト

```typescript
// Mock provider for tests
class MockResearchProvider implements ResearchProvider {
  async search(query: string) {
    return [{ url: "https://example.com", title: "Test", snippet: "..." }];
  }
  name = "mock";
}
```

## Firecrawl Policy / Firecrawl 方針

- `FirecrawlProvider` implements `ResearchProvider` interface for future swap-in
- **No npm install of Firecrawl SDK**
- **No API calls to Firecrawl**
- **No Firecrawl API key in env templates**
- Documented as fallback interface only

## Related / 関連

- [Research Pipeline](./research-pipeline.md)
- [ADR 002: Provider Architecture](../adr/002-provider-architecture.md)
