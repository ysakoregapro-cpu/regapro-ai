# Legacy Identity Migration / 旧システム同一性の移行

旧・経費 / 売上 / 週払いシステムのデータを `staff_id` へ安全に対応付けるための運用手順。

**現時点で本番データの移行は実施していない。** ここに書かれているのは、実施するときの手順と、そのために用意済みの仕組み。

## 前提 / Premise

旧システムのユーザー ID は現行 Supabase の `auth.users.id` と**一致しない**。同一とみなす前提でスクリプトを書いてはならない。

対応付けは必ず `staff_identities` を経由する:

```
legacy_expense.user_id      ─┐
legacy_sales.user_id        ─┼→ staff_identities → staff.staff_id
legacy_weekly_pay.user_id   ─┘
```

`UNIQUE (source_system, external_user_id)` により、同じ外部 ID が二人に割り当たることはない。

## 用意済みのテーブル / Scaffolding

`supabase/migrations/20260828122000_legacy_migration_foundation.sql`

| テーブル | 役割 |
|---|---|
| `migration_import_batches` | 取り込み単位。`dry_run` 既定 true、`status` で進行を管理 |
| `migration_source_records` | 旧システムの生データ。`content_hash` で再取り込みを検出 |
| `migration_identity_matches` | 「この外部 ID はこの staff」の**提案**。確定するまで紐づけない |
| `migration_errors` | 失敗の記録。バッチ単位で再実行できるように |

すべて `regapro_can_manage_staff` を持つ管理者のみアクセス可能。旧システムの個人情報を含むため。

過剰と判断すれば使わなくてもよいが、バッチ単位のロールバックと突合レビューは実運用でほぼ必ず必要になる。

## 手順 / Procedure

### 0. 準備

Phase 1 マイグレーションを対象プロジェクトに適用しておく。

```bash
npx supabase db push        # レビュー後に実行
npm run db:gen-types        # 生成型を更新
npm run db:test-rls         # 追加ケースが SKIP から実行に変わる
```

### 1. staff を先に作る

業務データより先に人を作る。`staff_no` は旧システムの社員番号を流用してよいが、**再利用しない**（退職者の番号を新入社員に割り当てない）。

```
entity_kind = 'staff'
dry_run = true
```

まず `dry_run` で件数と重複を確認し、問題なければ適用する。

### 2. 同一性を突合する

`migration_identity_matches` に提案を書き込む。`match_method`:

| 方法 | 信頼度 | 備考 |
|---|---|---|
| `existing_identity` | 最高 | 既に `staff_identities` にある |
| `staff_no` | 高 | 社員番号が一致 |
| `email` | 中 | 旧システムのメールが現行ログインと一致 |
| `name` | 低 | 同姓同名に注意。必ず人が確認する |
| `manual` | — | 人が指定 |

`status = 'proposed'` のまま自動で紐づけない。人が `confirmed` にしたものだけを `staff_identities` に反映する。

`staff_id` が NULL のまま残った行は、退職者・アカウント統合漏れ・別人の可能性がある。**未解決のまま業務データを取り込まない。**

### 3. 業務データを取り込む

確定した対応付けを使い、業務データの人物参照を `staff_id` に置き換えて取り込む。

- 1 バッチ = 1 エンティティ種別（`expense` / `sales` / `weekly_pay`）
- 失敗は `migration_errors` に記録し、バッチ単位で再実行
- `content_hash` が同じ行はスキップ（冪等）

### 4. 権限を付与する

取り込みだけでは何も見えない。`staff_role_assignments` でロールを割り当てて初めて機能が現れる。

```
アルバイト（週払いのみ）  platform_base + platform_weekly_pay_submitter
営業社員                  platform_base + platform_ai_user + platform_sales_viewer
経理                      platform_base + platform_expense_manager
```

雇用形態からロールを自動決定しない。`employment_type` は権限の入力ではない。

## 禁止事項 / Prohibited

- 旧 `auth.users.id` を現行 `auth.users.id` と同一とみなす
- `staff_id` を `auth.users.id` で上書きする破壊的マイグレーション
- 突合未確定のまま業務データを取り込む
- `staff_no` の再利用
- `service_role` で通常の権限経路を迂回した取り込み（バッチ処理は独立プロセスで実行し、Next.js からは呼ばない）
- 旧 DB の破壊・改変

## ロールバック / Rollback

バッチ単位で戻せるよう、取り込んだ行には `batch_id` を残す設計にする。`migration_import_batches.status = 'rolled_back'` にした上で、そのバッチが作成した行だけを削除する。

`staff` と `staff_identities` は原則ロールバックしない。`staff_no` を再利用しないため、間違えた場合は `status = 'left'` にして新しい行を作る。

## 検証 / Verification

移行後に必ず確認する:

```bash
npm run db:test-rls     # クロス組織分離・権限管理の拒否
npm run e2e:release     # 既存 AI 機能のリグレッション
```

加えて手動で:

- 各雇用形態の代表ユーザーでログインし、ナビに出るモジュールが想定どおりか
- ナビに出ないモジュールの URL を直接開いて拒否されるか
- 旧システムの本人の記録が、本人にだけ見えるか
