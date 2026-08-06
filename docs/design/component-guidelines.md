# Component Guidelines / コンポーネントガイドライン

## Architecture / アーキテクチャ

```
UI Component
  → Application Service (server action / API)
    → Domain + Repository/Provider
```

**UI は Repository / Provider を直接呼ばない。** 型付き Application Service 経由のみ。

## Component Categories / カテゴリ

### Shell / シェル

| Component | Purpose |
|---|---|
| `AppShell` | グローバルナビ + メイン領域 |
| `PageHeader` | コンパクトタイトル + アクション（1 Primary） |
| `SplitPane` | リスト + 詳細の 2 ペイン |

### Data Display / データ表示

| Component | Purpose | Notes |
|---|---|---|
| `DataTable` | 一覧表示 | カードグリッドの代替 |
| `CompactList` | モバイル向けリスト | 行単位、カード不使用 |
| `StatusBadge` | ステータス表示 | 色 + ラベル |
| `InlineMetric` | 文脈内メトリクス | 巨大 KPI カード禁止 |
| `Timeline` | アクティビティ履歴 | |

### Input / 入力

| Component | Purpose |
|---|---|
| `TextField` | 単行入力 |
| `TextArea` | 複数行 |
| `Select` | 選択 |
| `DatePicker` | 日付 |
| `SearchInput` | 検索（Cmd+K 連携） |

### Actions / アクション

| Component | Purpose | Rules |
|---|---|---|
| `Button` | アクション | variant: primary / secondary / ghost / danger |
| `ButtonGroup` | 関連アクション | Primary 1 つ + 残りは secondary/ghost |
| `IconButton` | アイコンのみ | aria-label 必須 |
| `DropdownMenu` | 二次アクション | |

**禁止:** 同列の Primary ボタンを 3 つ以上並べる。

### Overlay / オーバーレイ

| Component | Shadow | Radius |
|---|---|---|
| `Modal` | `--shadow-modal` | `--radius-lg` |
| `Drawer` | `--shadow-drawer` | `--radius-lg` |
| `Dropdown` | `--shadow-menu` | `--radius-md` |
| `Toast` | `--shadow-menu` | `--radius-md` |
| `Sheet` (mobile) | `--shadow-drawer` | top `--radius-lg` |

### Work Unit Components / 作業単位コンポーネント

| Component | Work Unit |
|---|---|
| `ProjectSummary` | 案件 |
| `CustomerCard` | 顧客（コンパクト、巨大カード禁止） |
| `TaskRow` | タスク |
| `ResearchPanel` | 調査 |
| `ArtifactEditor` | 成果物 |

## Styling Rules / スタイル規則

- Background: `#F7F7F5`, Surface: `#FFFFFF`, Accent: `#0F766E`
- Spacing: 8px scale
- Radius: 6–12px
- No blue-purple gradients, glow, glass, AI decorations
- Don't wrap every item in `<Card>` — use semantic HTML

## Type Safety / 型安全

```typescript
// Good: typed view model from Application Service
interface TaskRowProps {
  task: TaskViewModel;
  onComplete: (id: string) => void;
}

// Bad: any or raw DB row
interface TaskRowProps {
  task: any;
}
```

## Accessibility / アクセシビリティ

- すべての IconButton に `aria-label`
- Modal: focus trap + `aria-modal`
- Table: `<th scope="col">` + caption または `aria-label`
- 色だけに依存しないステータス表示

## Mobile / モバイル

- `CompactList` をデフォルト — desktop テーブルの縦積み禁止
- Primary action は `BottomActionBar`
- フィルタは `Sheet` で表示

## Related / 関連

- [Design Tokens](./design-tokens.md)
- [Mobile Patterns](./mobile-patterns.md)
- [Anti-Patterns](./anti-patterns.md)
