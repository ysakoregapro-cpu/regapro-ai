# ADR 004: Browser Local LLM

## Status

Accepted

## Date

2026-01-25

## Context / 背景

ADR 003 で外部 AI をオプションとした。プライバシー重視のユーザーには、データをサーバーに送信しない AI 支援手段が必要。ブラウザ上でのローカル LLM 実行を検討。

## Decision / 決定

**Browser Local LLM** をオプション機能として提供する。

### Implementation

- Runtime: WebGPU (primary) via `@mlc-ai/web-llm` or WASM fallback
- Models: Small models (3B–8B params) downloadable on user action
- Scope: 成果物下書き生成、選択テキストのインライン提案
- Data flow: inference in browser; saved content goes to Supabase only on explicit save

### Provider Interface

```typescript
class BrowserLocalLLMProvider implements LLMProvider {
  async isAvailable(): Promise<boolean> {
    return typeof navigator.gpu !== "undefined";
  }
  async generate(prompt: string, options?: LLMOptions): Promise<LLMResult> {
    // WebGPU inference — data never leaves browser
  }
}
```

### User Experience

- Settings → AI → 「ブラウザローカル LLM を有効にする」
- First use: model download (~2GB) with progress indicator
- UI indicator: 「ローカル処理中」vs「クラウド保存」

## Alternatives Considered / 検討した代替案

| Option | Verdict |
|---|---|
| Server-side local model (Ollama) | Rejected — requires server infra per org |
| No local option | Rejected — privacy requirement |
| Chrome built-in AI only | Rejected — too limited browser support |
| **WebGPU/WASM in browser** | **Selected** |

## Consequences / 結果

### Positive

- Zero data sent to external servers during inference
- No API cost
- Works offline (after model download)

### Negative

- Model quality inferior to GPT-4/Claude
- Large initial download
- WebGPU not available on all devices
- Cannot use for server-side batch processing

## Related ADRs

- [003: External AI Optional](./003-external-ai-optional.md)
- [005: Knowledge Answer Separation](./005-knowledge-answer-separation.md)
