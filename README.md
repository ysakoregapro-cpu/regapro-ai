# Regapro AI（レガプロ業務AI）

株式会社レガプロ専用の**業務OS**です。AIチャットアプリではありません。

社員が社内情報の検索、タスク、調査、文面・資料作成、ナレッジ蓄積を一つの場所で行うための社内プラットフォームです。

## モノレポ構成

```
apps/web/                 Next.js 16 App Router (@regapro/web)
packages/
  shared/                 環境検証・権限・日付・Result
  database/               Zodスキーマ・Repository・InMemory
  security/               権限・可視性・パス検証
  knowledge/              ナレッジ状態遷移
  research/               調査パイプライン・Fallback Provider
  tasks/                  タスク解釈・リマインダー
  notifications/          通知・配信・設定
  local-ai/               ブラウザLLM Provider
  prompting/              外部AI向けプロンプト生成
  artifacts/              ArtifactSpec / Renderer
  observability/          監査・診断
  ui/                     デザイントークン
services/
  research-worker/
  artifact-worker/
  notification-worker/
docs/                     product / architecture / design / operations / adr
supabase/migrations/      ローカル適用用（リモートへ自動適用しない）
.cursor/rules/            恒久的な製品・UIルール
```

## クイックスタート（dev-sample）

既定データモードは `REGAPRO_DATA_MODE=dev-sample` です。認証なしの架空データで画面確認できます。

```powershell
cd C:\Users\natan\source\regapro-ai
npm install
npm run dev
# → http://localhost:3000/home
```

## supabaseモード

`apps/web/.env.local` で `REGAPRO_DATA_MODE=supabase` と公開キーを設定します。  
無効値は静かに dev-sample へ戻さず、起動時エラーになります。

ローカルDB検証（Docker必須・リモート適用禁止）:

```powershell
npx supabase start
# 人間確認後のみ
# npx supabase db reset
```

## 品質ゲート

```powershell
npm run typecheck
npm run lint
npm run test
npm run build
```

## Firecrawl について

Firecrawl は**例外時 Fallback Provider のインターフェースと設定構造のみ**です。  
プラグインインストール・実API呼び出し・クレジット消費は行いません。

## ドキュメント

- [製品定義](docs/product/product-definition.md)
- [システム構成](docs/architecture/system-architecture.md)
- [環境変数](docs/operations/environment-variables.md)
- [dev-sample → supabase](docs/operations/dev-sample-to-supabase.md)
