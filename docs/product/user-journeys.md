# User Journeys / ユーザージャーニー

## Journey 1: 新規案件の立ち上げ / New Project Setup

**Persona:** 田中（営業マネージャー）

```
[ログイン] → [今日] 画面
  → [+ 案件を作成]
  → 顧客選択（既存 or 新規）
  → 案件名・ステージ入力
  → [作成] → 案件詳細ページ
  → [+ タスクを追加] × 3
  → チームメンバーに割当
```

| Step | Screen | Primary Action |
|---|---|---|
| 1 | 今日 | 案件を作成 |
| 2 | 案件作成モーダル | 保存 |
| 3 | 案件詳細 | タスク追加 |
| 4 | タスク行 | 担当者割当 |

**Success:** 5 分以内に案件 + 初期タスクが作成される。

## Journey 2: 商談前調査 / Pre-Meeting Research

**Persona:** 佐藤（フィールドセールス）

```
[モバイル: 今日] → 14:00 商談タスクをタップ
  → 案件詳細 → [調査] タブ
  → [調査を開始] → クエリ入力
  → バックグラウンド実行 → 通知
  → ソース一覧確認 → 重要ソースをピン
  → 商談へ
```

| Step | Device | Key Pattern |
|---|---|---|
| 1 | Phone | Bottom tab → 今日 |
| 2 | Phone | Compact list → detail |
| 3 | Phone | Bottom sheet for research |
| 4 | Phone | Pull-to-refresh for results |

**Success:** 商談 30 分前にソース付き調査結果を確認できる。

## Journey 3: 提案書作成 / Proposal Creation

**Persona:** 鈴木（コンサルタント）

```
[案件詳細] → [成果物] タブ
  → [+ 下書きを作成] → テンプレート選択（提案書）
  → エディタ → 調査ソースから引用挿入
  → テキスト選択 → [AI 提案]（インライン）
  → 編集・確認
  → [レビュー依頼] → 田中が承認
  → [共有] → PDF エクスポート
```

**Success:** 調査ソースが脚注付きで提案書に反映される。

## Journey 4: 日次タスク処理 / Daily Task Processing

**Persona:** 田中（営業マネージャー）

```
[今日] → 未完了タスク 8 件
  → フィルタ: 期限超過
  → タスク完了 × 3
  → タスク詳細 → 案件リンク → ステージ更新
  → 残り 5 件は明日に延期
```

**Success:** 10 分で今日のタスクを処理。

## Journey 5: 組織セットアップ / Organization Setup

**Persona:** 山本（管理者）

```
[初回ログイン] → 組織名設定
  → [メンバー招待] → メール送信 × 5
  → [ロール設定] → マネージャー / メンバー / 閲覧者
  → [外部 AI 設定] → 無効（ブラウザ LLM のみ）
  → 完了
```

**Success:** 30 分以内にチーム全員がアクセス可能。

## Journey Map Summary / ジャーニーマップ概要

| Journey | Frequency | Device | Critical Path |
|---|---|---|---|
| 案件立ち上げ | Weekly | Desktop | 案件 → タスク |
| 商談前調査 | Daily | Mobile | タスク → 調査 |
| 提案書作成 | Weekly | Desktop | 調査 → 成果物 |
| 日次タスク | Daily | Both | 今日 → 完了 |
| 組織セットアップ | Once | Desktop | 設定 → 招待 |

## Related / 関連

- [User Personas](./user-personas.md)
- [Interaction Patterns](../design/interaction-patterns.md)
