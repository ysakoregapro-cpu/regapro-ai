# Web Intelligence Runtime / Web インテリジェンス実行基盤

Tavily / Firecrawl / Browserbase は **交換可能な Provider** です。RegaloProfessional AI 本体ではありません。将来 Exa や自社クローラへ差し替えられます。

一般ユーザー UI には provider 名を出しません（「調査中」「社内情報を確認中」「Web情報を確認中」）。

## Ports / ポート

`@regapro/web-intelligence`

- `WebSearchProvider` — 検索（Tavily が primary。Exa は slot。未接続時は `[]`。偽結果禁止）
- `WebContentProvider` — ページ取得（Firecrawl）
- `BrowserProvider` — JS / 操作が必要なときだけ（Browserbase。通常取得では使わない）
- `WebResearchProvider` — 上記のオーケストレーション

正規化型: `WebSource` / `ResearchEvidence`（title, url, canonicalUrl, snippet, extractedText, relevance, freshness, sourceQuality, citation）。

## Routing / 経路

```
Intent → ExternalQuerySanitizer → Tavily
  → normalize / dedupe / rank
  → 本文が必要なら Firecrawl
  → scrape 失敗かつ JS 必要なら Browserbase
```

Deep Research:

```
question decomposition（sanitized queries のみ）
  → 複数クエリ（上限あり）
  → search → fetch → quality → dedupe → evidence → context compression
```

無制限 fan-out は禁止。research ごとに max queries / results / pages / browser sessions / context chars / timeout。

## Security / サニタイズ

外部検索の前に必ず sanitizer を通します。流さないもの:

- 社員の private 情報、private conversation
- Level 2 / 3 の内部詳細、実給与、健康、苦情、経営限定データ
- 個人情報

例: 「田中さんが年収○○で…求人を探して」→ 「23歳 / SES / Java / 東京 / 開発職」のような公開条件だけ。sanitize 前の query は provider に送りません。

## Internal Knowledge × Web

高度な質問では社内 Knowledge と Web Evidence を **別取得** し、ContextBuilder が provenance を維持したまま Reasoning モデルへ渡します。LLM に検索そのものを丸投げしません。

## Citation / 出典

既存 Citation 構造に統合。provider の citation をそのまま信じず canonicalize / dedupe。存在しない URL は作りません。

## Knowledge promotion / ナレッジ化

Web 結果は回答に即時利用してよい。ただし **自動 Published 禁止**。

`raw/source → fact/candidate → review → approved → published`

Research から Knowledge Candidate（draft）は作れます。private conversation を組織 Knowledge へ直接昇格しません。

## Budget / 予算

`WebBudgetGuard` がクエリ数・取得ページ・ブラウザセッション・文字数・timeout を制限します。
