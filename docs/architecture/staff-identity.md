# Staff Identity / 人の同一性

## 原則 / Core principle

統合アプリにおける人の正準識別子は **`staff.staff_id`**。`auth.users.id` ではない。

```
auth.users            ログイン識別子 (Login Identity)
    ↓  staff_identities
staff.staff_id        人の正準識別子 (Person Identity)
```

`auth.users` は今後もログイン手段として維持する。**既存 `auth.users.id` を `staff_id` に置き換える破壊的マイグレーションは禁止**。両者が一致することも前提にしない。

なぜ分けるか:

- 旧・経費/売上/週払いシステムのユーザー ID は現行 Supabase の `auth.users.id` と**一致しない**。
- 一人が複数のログイン手段を持ちうる。
- アルバイトなど、ログインを持たない期間がある人も業務データ上は存在しうる。

## staff

`supabase/migrations/20260828120000_staff_identity_foundation.sql`

| 列 | 説明 |
|---|---|
| `staff_id` | PK。**FK は原則これを参照する。** |
| `org_id` | テナント境界。RLS とクロス組織分離の基点。 |
| `staff_no` | 人間可読の識別子。表示用であり FK には使わない。 |
| `name` | 氏名 |
| `employment_type` | `executive` / `employee` / `part_time` |
| `status` | `active` / `suspended` / `left` |
| `joined_at` / `left_at` | 在籍期間 |
| `created_at` / `updated_at` | 監査用 |

### staff_no を再利用しない / No reuse

`UNIQUE (org_id, staff_no)` は**部分インデックスにしていない**。退職者の行も残り続けるため、番号は構造的に再利用できない。

退職は削除ではなく `status = 'left'` への遷移で表す。行を物理削除しないことが再利用防止の担保になっている。

### staff_no 採番ルール / Numbering policy

正式形式: **`RP-000001`**, **`RP-000002`**, …（組織内で連番）

| 要件 | 内容 |
|---|---|
| スコープ | 組織単位（`org_id` ごとに独立カウンタ） |
| 不変 | 一度割り当てた番号は変更しない |
| 再利用禁止 | 退職（`status = 'left'`）後も番号は保持 |
| 意味を含まない | 雇用形態・部署・ロール等の情報は含めない |
| FK 用途 | **禁止** — ドメイン FK は `staff_id` (uuid) のみ |
| 同時実行 | `staff_no_counters` + `regapro_next_staff_no()` で DB 側 atomic 採番 |
| 旧社員番号 | 必要なら `staff_identities.metadata` で別管理（`staff_no` には流用しない） |

マイグレーション: `supabase/migrations/20260831120000_staff_no_sequence.sql`

Admin UI からの新規 Staff 作成時も同関数で採番する。手入力・推測・ランダム UUID による偽番号は禁止。

### employment_type は権限ではない

`employment_type` は契約形態のみを表す。権限判定関数（TypeScript の `hasPermission()`、SQL の `regapro_staff_has_permission()`）のどちらにも登場しない。

`packages/platform/src/rbac.test.ts` の "employment type is not a permission input" と、RLS 側の "executive employment_type alone DENIED …" がこれを検証する。

employment_type を増やす場合は `EMPLOYMENT_TYPES`（`packages/shared/src/staff.ts`）と `staff.employment_type` の CHECK 制約の両方を更新する。

**Backfill / Admin UI 作成時は明示入力必須。** Role や Department からの推論禁止。不明な場合は apply を拒否する（`requires_review` への silent fallback 禁止）。

## staff_identities

| 列 | 説明 |
|---|---|
| `staff_id` | 対応する人 |
| `identity_type` | `app_auth` / `legacy_user` / `service_account` / `external_directory` |
| `source_system` | `regapro_app` / `legacy_expense` / `legacy_sales` / `legacy_weekly_pay` / 将来の任意システム |
| `external_user_id` | そのシステム内での ID |
| `auth_user_id` | `identity_type = 'app_auth'` のときのみ設定 |
| `metadata` | 取り込み時の補助情報 |

制約:

- `UNIQUE (source_system, external_user_id)` — 同じ外部 ID が二人に割り当たらない。
- `UNIQUE (auth_user_id) WHERE identity_type = 'app_auth'` — 一つのログインは高々一人にしか紐づかない。

`source_system` を自由文字列にしているのは、将来システムをマイグレーションなしで受け入れるため。既知の値は `KNOWN_SOURCE_SYSTEMS` に定数化してある。

## staff_departments

所属。`departments`（既存）への多対多。`job_title` は説明的な情報にすぎず、権限判定には使わない。

`is_primary` は部分ユニークインデックスで一人一つに制限。

## 解決 API / Resolution

`apps/web/src/lib/platform/`

| 関数 | 役割 |
|---|---|
| `resolveCurrentStaff()` | ログイン → staff + 権限グラント。未連携なら `null`。 |
| `resolveAccessContext()` | AccessContext を組み立てる（Platform API） |
| `resolvePlatformSession()` | 上記 + 既存 AppSession |

すべて React の `cache()` でリクエスト内メモ化されるので、レイアウト・ページ・ガードが同じ解決結果を共有する。

SQL 側:

| 関数 | 役割 |
|---|---|
| `regapro_current_staff_id()` | `auth.uid()` → `staff_id`。**active のみ**。 |
| `regapro_staff_belongs_to_org(org_id)` | staff としての組織所属 |
| `regapro_can_read_org(org_id)` | AI メンバーシップ **または** staff 所属 |

`regapro_current_staff_id()` が suspended / left で `NULL` を返すため、休止・退職者は platform 権限を一切持たない。

`regapro_can_read_org()` が二本立てなのは、AI メンバーシップを持たないアルバイトが業務モジュールだけ使うケースを想定しているため。

## AccessContext の追加フィールド

`packages/security/src/index.ts`。すべて任意フィールドなので既存の構築箇所は無変更で動く。

```ts
authUserId      // ログイン識別子（userId と同値。混同防止のため明示）
staffId         // 正準識別子。未連携なら null
staffNo
employmentType  // 表示用。権限には使わない
staffStatus
departmentIds   // 全所属（departmentId は主所属のまま）
roleIds
permissions     // Feature Permission のグラント
scopes
```

既存の `permissionKeys`（`chat:use` 形式）は AI 軸のまま残る。`staffFieldsOf(ctx)` で `undefined` を正規化できる。

## 互換モード / Compatibility mode

`staffId === null` のとき互換モード。次のいずれでも発生する:

1. Phase 1 マイグレーションが未適用（`PGRST205` / `42P01` を検出して静かにフォールバック）
2. マイグレーション適用済みだが、その利用者がまだ backfill されていない

このとき `withLegacyCompatibilityGrants()` が既存 AI 権限から Feature Permission を導出し、出荷済みモジュール（`legacyFallbackVisible`）の表示を維持する。**既存利用者の見え方は変わらない。**

## 既知の制約 / Known gap

AI の organization membership を持たない staff は、まだセッションを解決できない。情報区分（clearance）が membership の部署から導出されるため。Staff 単独セッションは最初の業務モジュールと同時に対応する（Phase 5）。
