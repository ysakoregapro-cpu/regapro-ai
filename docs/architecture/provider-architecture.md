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

実装の正本は [Web Intelligence Runtime](./web-intelligence-runtime.md) です。SearXNG は互換 slot として残しています。

| Provider | Role | Status |
|---|---|---|
| Tavily (`WebSearchProvider`) | Primary web search / research | Connected when `TAVILY_API_KEY` is set |
| Firecrawl (`WebContentProvider`) | Page fetch / scrape | Connected when `FIRECRAWL_API_KEY` is set |
| Browserbase (`BrowserProvider`) | JS / interactive escalation only | Connected when Browserbase env is set |
| Exa | Secondary search slot | Interface; no fake results |
| SearXNG | Legacy slot | Empty results unless configured |

LLM / 推論は [Cloud Model Runtime](./cloud-model-runtime.md)。Vercel AI Gateway は製品本体ではありません。

コーディング（貼り付け / Local Workspace / Vibe）は [Coding Agent Runtime](./coding-agent.md)。filesystem は ai-runtime に埋めません。

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
| `VercelGatewayModelProvider` | Cloud inference engine (swappable) | Server |
| `SelfHostedModelProviderSlot` | Future self-host replacement | Server |
| `BrowserLocalLLMProvider` | Optional on-device | Client (WebGPU/WASM) |
| `HonestFallbackModelProvider` | Default when none connected | — |

See [Cloud Model Runtime](./cloud-model-runtime.md). Gateway / OpenAI / Anthropic は製品名ではありません。

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
