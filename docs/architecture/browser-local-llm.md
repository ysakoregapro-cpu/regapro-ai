# Browser Local LLM / ブラウザローカル LLM

Regapro AI は外部 AI API なしでも基本動作可能。ブラウザ上でローカル LLM を実行するオプションを提供する。

## Motivation / 動機

- データを外部に送信しない選択肢（セキュリティ、コンプライアンス）
- 外部 API コスト不要
- オフライン環境での限定的利用
- 外部 AI は **オプション** — 必須ではない

See [ADR 003](../adr/003-external-ai-optional.md) and [ADR 004](../adr/004-browser-local-llm.md).

## Architecture / アーキテクチャ

```
┌─────────────────────────────────────────┐
│              Browser                     │
│  ┌─────────────┐  ┌─────────────────┐  │
│  │ Artifact    │  │ BrowserLocalLLM │  │
│  │ Editor (UI) │──│ Provider        │  │
│  └─────────────┘  │ (WebGPU/WASM)   │  │
│                   └─────────────────┘  │
│  Prompt + context → Local inference     │
│  Result → Editor (never sent to server   │
│           unless user explicitly saves)  │
└─────────────────────────────────────────┘
```

## Provider Interface / プロバイダーインターフェース

```typescript
interface LLMProvider {
  generate(prompt: string, options?: LLMOptions): Promise<LLMResult>;
  isAvailable(): Promise<boolean>;
  name: string;
}

interface LLMOptions {
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

interface LLMResult {
  text: string;
  tokensUsed?: number;
  modelId?: string;
}
```

## Implementation Options / 実装オプション

| Runtime | Library | Model Format | Notes |
|---|---|---|---|
| WebGPU | `@mlc-ai/web-llm` | GGUF | Recommended for modern browsers |
| WASM | `transformers.js` | ONNX | Fallback for no WebGPU |
| WebLLM | `@built-in-ai/web-llm` | Chrome built-in AI | Chrome 127+ experimental |

## Usage Scope / 利用範囲

Browser local LLM is suitable for:

| Use Case | Suitable | Notes |
|---|---|---|
| 成果物の下書き生成 | ✅ | User-initiated |
| 選択テキストの書き換え提案 | ✅ | Inline assist |
| 調査ソースの要約 | ⚠️ | Small snippets only |
| 大規模調査クエリ | ❌ | Use server-side research pipeline |

## User Settings / ユーザー設定

Settings → AI → ローカル LLM:

```
[ ] ブラウザローカル LLM を有効にする
モデル: [Llama 3.2 3B ▼]  (初回ダウンロード ~2GB)
GPU: WebGPU 利用可能 ✅
```

- Model download is explicit user action
- Progress indicator during download
- No auto-download

## Privacy / プライバシー

- Local inference: data stays in browser
- Saved artifacts: stored in Supabase (org-scoped, RLS)
- User must understand: saving = data goes to server
- Clear UI indicator: 「ローカル処理中」vs「クラウド保存」

## Fallback Chain / フォールバックチェーン

```
1. Browser Local LLM (if enabled and available)
2. External LLM (if org admin configured)
3. No AI — manual editing only
```

## Limitations / 制限

- Model quality < cloud models (3B–8B params)
- Initial download size (1–4 GB)
- WebGPU required for acceptable performance
- Not suitable for batch/server-side processing

## Related / 関連

- [Provider Architecture](./provider-architecture.md)
- [Artifact Generation](./artifact-generation.md)
