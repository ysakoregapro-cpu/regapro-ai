# Visual Language / ビジュアル言語

## Design Philosophy / デザイン哲学

Regapro AI は **静かで信頼できる業務ソフト** の見た目を目指します。

- AI プロダクトの cliché（グラデーション、グロー、sparkle）を避ける
- 情報密度と可読性のバランス
- 装飾より **構造とタイポグラフィ** で階層を作る

## Color System / カラーシステム

| Role | Token | Hex | Usage |
|---|---|---|---|
| Accent / Primary | `--color-accent` | `#0F766E` | ボタン、リンク、アクティブ状態 |
| Background | `--color-bg` | `#F7F7F5` | アプリ背景 |
| Surface | `--color-surface` | `#FFFFFF` | パネル、入力、テーブル行 |
| Text | `--color-text` | `#1F2937` | 本文 |
| Text Muted | `--color-text-muted` | `#6B7280` | 補助テキスト、ラベル |
| Border | `--color-border` | `#E5E7EB` | 区切り線、入力枠 |
| Danger | `--color-danger` | `#DC2626` | 削除、エラー |
| Warning | `--color-warning` | `#D97706` | 注意 |
| Success | `--color-success` | `#059669` | 完了（accent と同系統） |

### Forbidden / 禁止

- 青（`#3B82F6`）〜 紫（`#8B5CF6`）のグラデーション背景
- ネオングロー、`backdrop-filter: blur` によるガラス効果
- 星・sparkle・ロボットアイコンの装飾的使用

## Typography / タイポグラフィ

| Level | Size | Weight | Usage |
|---|---|---|---|
| Page title | 18–20px | 600 | ページタイトル（巨大化しない） |
| Section title | 14–16px | 600 | セクション見出し |
| Body | 14px | 400 | 本文 |
| Caption | 12px | 400 | タイムスタンプ、メタ情報 |
| Mono | 13px | 400 | コード、ID（一般ユーザー UI では最小限） |

- 日本語: システム UI フォントスタック（ Hiragino, Yu Gothic, Meiryo, sans-serif ）
- 英語: Inter または Geist Sans
- **長い説明文をタイトル下に置かない** — 必要なら折りたたみ Help

## Spacing / スペーシング

8px ベーススケール:

| Token | Value |
|---|---|
| `--space-1` | 8px |
| `--space-2` | 16px |
| `--space-3` | 24px |
| `--space-4` | 32px |
| `--space-5` | 40px |
| `--space-6` | 48px |

## Radius / 角丸

| Element | Radius |
|---|---|
| Buttons, inputs | 6px |
| Panels, cards (when used) | 8–12px |
| Modals | 12px |
| **Never** | 20px+ on structural panels |

## Shadows / シャドウ

シャドウは **浮遊 UI のみ** に使用:

- Drawer / サイドパネル
- Dropdown / メニュー
- Modal / ダイアログ
- Toast

リスト行、テーブルセル、通常パネルにはシャドウを付けない。

## Iconography / アイコン

- 16px / 20px の線アイコン（Lucide 等）
- 意味のあるアイコンのみ — 装飾的 AI アイコン禁止
- ステータスは色 + アイコン + テキストラベルの組み合わせ

## Layout Patterns / レイアウト

### Preferred / 推奨

- フル幅テーブル + 固定ヘッダ
- 2 ペイン（リスト | 詳細）
- インライン編集可能フィールド

### Avoid / 避ける

- 3 列以上のカードグリッド
- すべてを Card コンポーネントでラップ
- ページ上部の KPI タイル 4 枚横並び

## Related / 関連

- [Design Tokens](./design-tokens.md)
- [Component Guidelines](./component-guidelines.md)
- [Anti-Patterns](./anti-patterns.md)
