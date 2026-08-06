# Mobile Patterns / モバイルパターン

## Core Principle / 基本原則

**モバイル UI は desktop の縦積みではない。**

スマートフォンは別の作業コンテキスト — 素早い確認、軽い更新、承認 — を想定して設計する。

## Layout Strategy / レイアウト戦略

### Phone (< 640px)

```
┌─────────────────────┐
│ ← 案件名        ⋮  │  Compact header
├─────────────────────┤
│                     │
│   Single focus      │  One primary task per screen
│   content area      │
│                     │
├─────────────────────┤
│  [Primary Action]   │  Bottom action bar
└─────────────────────┘
```

- グローバルナビ: ボトムタブ（5 項目まで）または ハンバーガー + ドロワー
- 3 列 desktop レイアウト → **タブ切替** または **スワイプ可能セクション**
- サイドパネル → **Bottom Sheet**

### Tablet (640–1024px)

- 2 ペイン許容（リスト | 詳細）
- ドロワーナビゲーション
- テーブル → 横スクロール + 先頭列固定

## Component Adaptations / コンポーネント適応

| Desktop | Mobile |
|---|---|
| DataTable | CompactList（行タップで詳細） |
| SplitPane | 一覧 → 詳細の画面遷移 |
| Sidebar filters | Filter Sheet（下から） |
| Inline edit | タップで編集モード |
| Dropdown actions | Action Sheet |
| Multi-column form | ステップフォーム or 折りたたみセクション |

## Touch / タッチ

- タップターゲット: 最小 44×44px
- スワイプ: タスク完了（右スワイプ）、削除（左スワイプ + 確認）
- Pull-to-refresh: 一覧画面のみ

## Navigation / ナビゲーション

### Bottom Tab Bar / ボトムタブ

```
[ 今日 ] [ 案件 ] [ タスク ] [ 調査 ] [ その他 ]
```

「その他」に顧客、成果物、設定を格納可能。

### Back Navigation / 戻る

- 常に明示的な戻るボタン（←）
- 案件詳細 → タスク → 編集 の階層を保持

## Anti-Patterns / 避けるパターン

- Desktop 3 列を flex-col で縦積み
- カードグリッド 2 列（情報密度不足 + タップしにくい）
- 巨大 KPI カード
- フローティング AI チャットボタン
- 二重スクロール（ヘッダ固定 + ネスト scroll 地獄）

## Performance / パフォーマンス

- 一覧は仮想スクロール（100 件以上）
- 画像・PDF プレビューは lazy load
- オフライン: タスク一覧のキャッシュ（将来）

## Visual Consistency / ビジュアル

モバイルでも同じトークン:

- Accent `#0F766E`, BG `#F7F7F5`, Surface `#FFFFFF`
- Radius 6–12px
- シャドウは Sheet / Modal のみ
- 青紫グラデーション、グロー、AI 装飾禁止

## Related / 関連

- [Responsive Behavior](../../.cursor/rules/responsive-behavior.mdc)
- [Component Guidelines](./component-guidelines.md)
