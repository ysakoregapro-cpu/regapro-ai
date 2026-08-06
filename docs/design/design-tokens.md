# Design Tokens / デザイントークン

Regapro AI のデザイントークン定義。Tailwind CSS v4 の `@theme` または CSS カスタムプロパティとして実装します。

## Colors / カラー

```css
:root {
  /* Brand */
  --color-accent: #0F766E;
  --color-accent-hover: #0D6B63;
  --color-accent-muted: #CCFBF1;

  /* Surfaces */
  --color-bg: #F7F7F5;
  --color-surface: #FFFFFF;
  --color-surface-raised: #FFFFFF; /* shadow で elevation */

  /* Text */
  --color-text: #1F2937;
  --color-text-muted: #6B7280;
  --color-text-inverse: #FFFFFF;

  /* Borders */
  --color-border: #E5E7EB;
  --color-border-strong: #D1D5DB;

  /* Semantic */
  --color-danger: #DC2626;
  --color-warning: #D97706;
  --color-success: #059669;
  --color-info: #0F766E; /* accent と同系 */
}
```

## Spacing Scale / スペーシング（8px ベース）

```css
:root {
  --space-0: 0;
  --space-1: 8px;
  --space-2: 16px;
  --space-3: 24px;
  --space-4: 32px;
  --space-5: 40px;
  --space-6: 48px;
  --space-7: 56px;
  --space-8: 64px;
}
```

## Border Radius / 角丸

```css
:root {
  --radius-sm: 6px;   /* buttons, inputs, badges */
  --radius-md: 8px;   /* inline panels */
  --radius-lg: 12px;  /* modals, drawers */
  /* Panels must NOT exceed 12px — no 20px+ */
}
```

## Shadows / シャドウ（drawers / menus / modals のみ）

```css
:root {
  --shadow-menu: 0 4px 12px rgba(0, 0, 0, 0.08);
  --shadow-drawer: -2px 0 12px rgba(0, 0, 0, 0.06);
  --shadow-modal: 0 8px 24px rgba(0, 0, 0, 0.12);
}
```

通常のリスト行・テーブル・ページ背景には `--shadow-*` を適用しない。

## Typography / タイポグラフィ

```css
:root {
  --font-sans: "Inter", "Hiragino Sans", "Hiragino Kaku Gothic ProN",
    "Yu Gothic", "Meiryo", sans-serif;
  --font-mono: "Geist Mono", "SF Mono", "Consolas", monospace;

  --text-xs: 12px;
  --text-sm: 13px;
  --text-base: 14px;
  --text-lg: 16px;
  --text-xl: 18px;
  --text-2xl: 20px;

  --leading-tight: 1.25;
  --leading-normal: 1.5;
  --leading-relaxed: 1.625;
}
```

## Z-Index / 重なり順

```css
:root {
  --z-base: 0;
  --z-sticky: 10;
  --z-dropdown: 20;
  --z-drawer: 30;
  --z-modal: 40;
  --z-toast: 50;
}
```

## Tailwind v4 Integration / Tailwind 連携例

```css
@theme inline {
  --color-accent: #0F766E;
  --color-bg: #F7F7F5;
  --color-surface: #FFFFFF;
  --color-text: #1F2937;
  --color-border: #E5E7EB;

  --spacing-1: 8px;
  --spacing-2: 16px;
  --spacing-3: 24px;
  --spacing-4: 32px;

  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
}
```

## Component Token Mapping / コンポーネントマッピング

| Component | Tokens |
|---|---|
| Button Primary | `accent`, `radius-sm`, `text-inverse` |
| Button Secondary | `surface`, `border`, `text` |
| Input | `surface`, `border`, `radius-sm`, `space-1` padding |
| Table | `surface`, `border`, no shadow |
| Modal | `surface`, `radius-lg`, `shadow-modal` |
| Drawer | `surface`, `shadow-drawer` |
| Nav active | `accent-muted` bg, `accent` text |

## Anti-Pattern Tokens / 使わないトークン

以下は定義しない（使用禁止）:

- `--gradient-ai`, `--gradient-purple-blue`
- `--glow-accent`, `--glass-bg`
- `--radius-xl: 24px` 以上
- `--shadow-card`（汎用カードシャドウ）

## Related / 関連

- [Visual Language](./visual-language.md)
- [Component Guidelines](./component-guidelines.md)
