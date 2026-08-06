# Accessibility / アクセシビリティ

## Standard / 基準

Regapro AI は **WCAG 2.1 Level AA** 準拠を目標とします。

アクセシビリティは `lint`, `typecheck`, `test`, `build` と同等の **完了ゲート** です。

## Color & Contrast / 色とコントラスト

| Combination | Ratio | Pass |
|---|---|---|
| `#1F2937` on `#FFFFFF` | 12.6:1 | AAA |
| `#1F2937` on `#F7F7F5` | 11.8:1 | AAA |
| `#0F766E` on `#FFFFFF` | 5.5:1 | AA (normal text) |
| `#6B7280` on `#FFFFFF` | 4.6:1 | AA |

- ステータス表示は **色 + アイコン + テキスト** の組み合わせ
- 青紫グラデーション背景は禁止（コントラスト問題 + 可読性）

## Keyboard / キーボード

- すべてのインタラクティブ要素が Tab 到達可能
- フォーカスリング可視（`outline: 2px solid #0F766E` 等）
- Modal: focus trap、`Escape` で閉じる、閉じた後 focus 復帰
- Skip link: 「メインコンテンツへ skip」

## Screen Reader / スクリーンリーダー

### Landmarks / ランドマーク

```html
<header role="banner">
<nav aria-label="メインナビゲーション">
<main id="main-content">
<aside aria-label="案件コンテキスト">
```

### Live Regions / ライブリージョン

- Toast: `role="status"` + `aria-live="polite"`
- 保存状態: `aria-live="polite"` — 「保存しました」
- エラー: `role="alert"` + `aria-live="assertive"`

### Tables / テーブル

```html
<table aria-label="案件一覧">
  <caption class="sr-only">進行中の案件 12 件</caption>
  <thead>
    <tr>
      <th scope="col">案件名</th>
```

## Forms / フォーム

- すべての input に `<label>` または `aria-label`
- エラー: `aria-invalid="true"` + `aria-describedby` でエラーメッセージリンク
- 必須: `aria-required="true"` + 視覚的 `*` + 「必須」テキスト

## Motion / モーション

- `prefers-reduced-motion: reduce` でアニメーション無効化
- 自動再生アニメーション禁止
- 点滅 3 回/秒以上禁止

## Mobile A11y / モバイル

- タッチターゲット 44×44px 以上
- スワイプアクションには代替（ボタン/menu）
- ピンチズーム禁止しない（`user-scalable=no` 禁止）

## Scroll / スクロール

- **二重スクロール禁止** — キーボードユーザーが trap される
- 固定ヘッダ + scroll body は 1 ペアのみ

## Testing / テスト

| Tool | Scope |
|---|---|
| axe-core (eslint-plugin-jsx-a11y) | CI lint |
| Playwright + axe | E2E critical paths |
| VoiceOver / NVDA | Manual QA per release |
| Keyboard-only walkthrough | Every new page |

## Content A11y / コンテンツ

- リンクテキストは説明的（「ここをクリック」禁止）
- 画像 `alt` 必須（装飾は `alt=""`)
- 言語: `<html lang="ja">`、英語部分は `lang="en"`

## Related / 関連

- [Component Guidelines](./component-guidelines.md)
- [Interaction Patterns](./interaction-patterns.md)
