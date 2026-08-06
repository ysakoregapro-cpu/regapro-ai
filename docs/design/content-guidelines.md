# Content Guidelines / コンテンツガイドライン

## Language Strategy / 言語戦略

Regapro AI は **日本語優先、英語併記** の B2B プロダクトです。

| Context | Primary | Secondary |
|---|---|---|
| UI ラベル | 日本語 | — |
| ボタン | 日本語 | 英語併記は設定画面のみ |
| エラーメッセージ | 日本語 | 技術詳細はログのみ |
| ドキュメント | 日英併記 | 本 docs 形式 |
| コード / API | 英語 | — |

## Voice & Tone / トーン

| Attribute | JA | EN |
|---|---|---|
| Professional | です・ます調 | Direct, concise |
| Helpful | 次のアクションを示す | Action-oriented |
| Honest | 不確実性を隠さない | Transparent about limits |
| Not | 過度にカジュアル、AI っぽい煽り | Hype, "magic", "powered by AI" |

### Good / 良い例

```
保存しました。
3 件のソースが見つかりました。内容を確認してください。
この案件には成果物がありません。[下書きを作成]
```

### Bad / 悪い例

```
✨ AI が魔法のように分析しました！
🚀 驚きの結果が得られました！
Provider SearXNG が 10 件返しました。
```

## Terminology / 用語

### User-Facing (Use) / ユーザー向け（使う）

| JA | EN | Definition |
|---|---|---|
| 案件 | Project / Deal | 商談・プロジェクト単位 |
| 顧客 | Customer | 取引先 |
| タスク | Task | 実行可能な作業 |
| 調査 | Research | 情報収集セッション |
| 成果物 | Artifact | 提案書、議事録等の出力 |
| 下書き | Draft | 未確定の成果物 |
| ソース | Source | 調査で見つかった参照 URL |

### Internal Only (Don't show in UI) / 内部のみ

Repository, Provider, Worker, Pipeline, Embedding, Vector, RAG, LLM, SearXNG, Firecrawl, Tavily, Exa

## Page Titles / ページタイトル

- **短く:** 「案件一覧」「〇〇商事」— 副題不要
- **長い説明をタイトル下に置かない**
- ヘルプが必要なら `?` アイコン → ツールチップ or ドロワー

## Empty States / 空状態

構造: **状況 + 次のアクション**

```
案件がまだありません。
最初の案件を作成して、タスクと成果物の管理を始めましょう。
[+ 案件を作成]
```

## Error Messages / エラーメッセージ

構造: **何が起きたか + ユーザーができること**

```
保存に失敗しました。ネットワーク接続を確認して、もう一度お試しください。
```

内部エラー（Provider 名、SQL）は **絶対に表示しない**。

## AI-Generated Content / AI 生成コンテンツ

- 生成物には「AI 下書き」ラベル（控えめ、装飾なし）
- ユーザー編集前は「確認が必要」と明示
- ソース引用がある場合は脚注リンク

## Formatting / 書式

- 日付: `2026年8月6日` または `2026/08/06`（組織設定で統一）
- 時刻: 24 時間制 `14:30`
- 数値: カンマ区切り `1,234`
- 通貨: `¥1,234,567`

## Related / 関連

- [Product Experience](./product-experience.md)
- [Anti-Patterns](./anti-patterns.md)
