# Cloud Model Runtime / クラウドモデル実行基盤

RegaloProfessional AI Runtime が主体です。Vercel AI Gateway は **推論エンジン** であり、製品本体ではありません。

将来は `VercelGatewayModelProvider`（ExternalModelProvider）を `SelfHostedModelProvider` に差し替えられます。業務ロジックは ModelProvider ポートの外に特定ベンダーを書きません。

## Architecture / アーキテクチャ

```
UI / Application Service
  → runAnswerPipeline
    → IntentRouter / RetrievalPlanner / ContextBuilder
    → ModelRouter + ModelPolicy（role: fast|main|reasoning|code|vision）
    → FallbackChainModelProvider
         1. primary cloud model
         2. secondary role
         3. alternate provider / self-hosted slot
         4. optional browser-local
         5. HonestFallback
```

Local LLM や GPU が無くても、クラウド経由で同一機能を利用できます。

## Roles / 役割

| Role | Default (overridable) | Typical use |
|---|---|---|
| fast | `REGAPRO_MODEL_FAST` | 構造化・短い言い換え |
| main | `REGAPRO_MODEL_MAIN` | 要約・一般生成 |
| reasoning | `REGAPRO_MODEL_REASONING` | 経営分析・複数情報統合 |
| code | `REGAPRO_MODEL_CODE` | TypeScript / GAS / SQL / Vibe Coding |
| vision | `REGAPRO_MODEL_VISION` | 画像・PDF |

単純な Knowledge 取得は LLM を使わず ContextGrounded で返します。

## Catalog / カタログ

`GET {AI_GATEWAY_BASE_URL}/models` で model id / capability / modalities / pricing を取得します。カタログ欠落時も env 既定 ID で継続し、アプリケーションは落ちません。

## Security / ZDR

- AccessContext の天井で **取得前フィルタ**。全部取ってから LLM に隠させません。
- ユーザーが request body で clearance を指定して昇格することはできません。
- `people` / `executive`（L2/L3）の外部 LLM リクエストは request-level で `zeroDataRetention: true` と `disallowPromptTraining: true`。
- `REGAPRO_GATEWAY_PROVIDER_ALLOWLIST` で provider allowlist を指定できます。

## Budget / 予算

Vercel 側の予算に加え、アプリケーション側で

- max LLM calls
- max tokens
- timeout
- reasoning retries
- recursion/loop limit

を強制します。無限 Agent loop は禁止です。Admin 診断でプロセス利用状況を確認できます。一般 UI に provider 料金は出しません。

## Observability / 観測

Langfuse Cloud（OpenTelemetry / `@langfuse/tracing`）に接続します。L2/L3 と private は **metadata-only**。API キーは trace に出しません。

## Embedding

Cloud Model Runtime は Local Embedding（`Xenova/multilingual-e5-small` / 384 次元）と独立です。別モデルの query vector を既存 E5 index に投げません。
