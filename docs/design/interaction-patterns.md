# Interaction Patterns / インタラクションパターン

## Global Interactions / グローバル

### Command Palette / コマンドパレット

- **Trigger:** `Cmd/Ctrl + K`
- **Scope:** 案件、顧客、タスク、成果物の横断検索 + クイックアクション
- **Not:** AI チャット入力（ビジネス OS として作業検索が主）

### Navigation / ナビゲーション

- グローバルナビは作業単位ベース
- 現在位置は accent 色 + 下線（グラデーション禁止）
- ブラウザバック対応 — モーダルは URL 同期（deep link 可能）

## CRUD Patterns / CRUD パターン

### Create / 作成

1. 一覧ページの Primary ボタン 1 つ（例: `+ 案件を作成`）
2. モーダルまたはスライドインフォーム
3. 必須フィールド最小 → 作成後に詳細ページへ
4. 楽観的 UI は使わない — 保存確認後に遷移

### Edit / 編集

- **インライン編集** を優先（タイトル、ステータス、担当者）
- 長文はエディタビューへ
- 自動保存 + 「保存しました」インジケータ（3 秒でフェード）

### Delete / 削除

- 確認ダイアログ（danger variant）
- ソフトデリート — UI では「削除」、復元可能期間あり

## Research Flow / 調査フロー

```
[調査を開始] → クエリ入力 → バックグラウンド実行
  → ソース一覧（タイトル、URL、スニペット）
  → ソース選択 → 案件メモへ引用
  → 成果物下書きへ反映
```

- 調査中はインライン progress（全画面ローディング禁止）
- ソースはクリック可能 — 外部リンクは新タブ
- Provider 名（SearXNG 等）はユーザーに表示しない

## Artifact Flow / 成果物フロー

```
[下書き作成] → エディタ → AI 提案（インライン）
  → レビュー依頼 → 承認/差戻し → 共有/エクスポート
```

- AI 支援は **選択テキストへの提案** — サイドチャット禁止
- 版管理: 自動保存 + 明示的バージョン

## Feedback Patterns / フィードバック

| Pattern | Usage |
|---|---|
| Toast | 保存完了、エラー（5 秒自動 dismiss） |
| Inline error | フォームバリデーション |
| Skeleton | 初回ロード |
| Empty state | データなし + Primary CTA 1 つ |

## Scroll Behavior / スクロール

- **二重スクロール禁止:** AppShell は `overflow: hidden`、コンテンツペインのみ scroll
- テーブル: ヘッダ固定 + ボディ scroll（1 コンテナ）
- モーダル内: コンテンツが長い場合のみ modal body scroll

## Button Hierarchy / ボタン階層

| Level | Variant | Max per context |
|---|---|---|
| Primary | filled accent | 1 |
| Secondary | outlined | 2 |
| Tertiary | ghost / link | unlimited |
| Destructive | danger | 1（確認付き） |

## Keyboard / キーボード

| Key | Action |
|---|---|
| `Cmd/Ctrl + K` | Command palette |
| `Cmd/Ctrl + S` | Save (editor) |
| `Escape` | Close modal/drawer |
| `Enter` | Submit form |
| `Tab` | Focus next |

## Related / 関連

- [Mobile Patterns](./mobile-patterns.md)
- [Accessibility](./accessibility.md)
