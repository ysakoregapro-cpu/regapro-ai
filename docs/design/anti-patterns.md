# Anti-Patterns / アンチパターン

Regapro AI で **明示的に禁止** する UI/UX/アーキテクチャパターン一覧。

## Product Anti-Patterns / プロダクト

| Anti-Pattern | Why | Instead |
|---|---|---|
| AI チャットをホーム画面にする | ビジネス OS ではない | 今日のタスク / 進行中案件 |
| 機能名ナビ（RAG, Pipeline） | ユーザーの mental model と不一致 | 作業単位ナビ |
| Provider 名を UI に表示 | 実装詳細の露出 | 「調査」「ソース」 |
| 巨大 KPI ダッシュボード |  vanity metrics、作業を遠ざける | 文脈内インラインメトリクス |
| "Ask AI anything" | 汎用チャット = 別プロダクト | 文脈限定 AI 支援 |

## Visual Anti-Patterns / ビジュアル

| Anti-Pattern | Why | Instead |
|---|---|---|
| 青紫グラデーション | AI demo cliché | フラット `#F7F7F5` + `#0F766E` accent |
| グロー / glass / sparkle | 読みにくい、業務ソフトに不適 | ボーダー + タイポグラフィ |
| 大角丸カードグリッド (20px+) | 情報密度低、タップしにくい | テーブル / コンパクトリスト |
| すべてを Card でラップ | 視覚ノイズ | セクション + border-bottom |
| 巨大ページタイトル + 長文説明 | スクロール浪費 | コンパクトヘッダ + Help アイコン |
| 汎用カードシャドウ | elevation 乱用 | shadow は modal/drawer/menu のみ |

## Interaction Anti-Patterns / インタラクション

| Anti-Pattern | Why | Instead |
|---|---|---|
| 同列 Primary ボタン 3+ | 意思決定負荷 | Primary 1 + secondary/menu |
| 二重スクロール | UX 地獄 | 単一 scroll コンテナ |
| Desktop 列のモバイル縦積み | 使いにくい | タブ / Sheet / 画面遷移 |
| 全画面ローディング | 文脈喪失 | インラインプログレス |
| サイド AI チャットパネル | チャットアプリ化 | インライン AI 提案 |

## Architecture Anti-Patterns / アーキテクチャ

| Anti-Pattern | Why | Instead |
|---|---|---|
| UI → Repository 直接 | レイヤー違反、テスト困難 | Application Service |
| UI → Provider 直接 | 差し替え不可、秘密漏洩リスク | Service 経由 |
| `any` 乱用 | 型安全性喪失 | 明示的 DTO / Zod |
| 秘密情報を client へ | セキュリティ事故 | server-only env |
| Firecrawl 直接呼び出し | 方針違反、コスト | SearXNG primary + interface fallback |

## Content Anti-Patterns / コンテンツ

| Anti-Pattern | Example | Instead |
|---|---|---|
| AI 煽り文句 | "魔法の AI" | 事実ベースの説明 |
| 技術エラー表示 | "SearXNG timeout" | "調査に失敗しました。再試行してください。" |
| 機能マーケティング | "Powered by GPT-4" | （表示しない） |

## Process Anti-Patterns / プロセス

| Anti-Pattern | Instead |
|---|---|
| lint/typecheck/test/build をスキップ | `npm run check` 必須 |
| デザインシステム無視の one-off | トークン + コンポーネント再利用 |
| モバイル後付け | mobile-first または parallel 設計 |

## Checklist Before Ship / リリース前チェック

- [ ] ホームは作業起点（チャットではない）
- [ ] ナビは作業単位
- [ ] 内部名を UI に出していない
- [ ] グラデーション / グロー / AI 装飾なし
- [ ] カードグリッド / 巨大 KPI なし
- [ ] Primary ボタン 1 つ per context
- [ ] 二重スクロールなし
- [ ] モバイル専用レイアウト
- [ ] Application Service 経由のみ
- [ ] `npm run check` パス
