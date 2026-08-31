# Staff Backfill / 既存 AI 利用者 → Staff 移行

既存 Regapro AI 利用者を `staff` + `staff_identities` へ安全に移行する手順。

**Apply 前は必ず dry-run。** 実 DB への書き込みは人間確認後に `--apply` のみ。

## 前提

- Phase 1 マイグレーション（staff / RBAC / migration 基盤）が適用済み
- Backfill 用マイグレーションが適用済み:
  - `20260831120000_staff_no_sequence.sql`
  - `20260831121000_staff_backfill_rpc.sql`
- `npm run db:gen-types` 実行済み

## staff_no

組織内連番 `RP-000001` 形式。詳細は `docs/architecture/staff-identity.md`。

DB 関数 `regapro_next_staff_no(org_id)` が atomic に採番。スクリプト側で番号を生成しない。

## employment_type

| 値 | 意味 |
|---|---|
| `executive` | 役員 |
| `employee` | 社員 |
| `part_time` | アルバイト |

**Apply 時に `--employment-type` で明示指定必須。** Role / Department から推論しない。不明なら apply 拒否。

## Backfill 対象

正式判定: `user_category = ai_user`

| 条件 | 内容 |
|---|---|
| membership あり | `organization_memberships` が存在 |
| role あり | `membership_roles` が 1 件以上 |
| AI 利用可能 | permission key に `chat:use` / `coding:use` / `knowledge:read` / `research:run` / `task:read` のいずれか |

**対象外（自動除外）:**

- `membership_without_roles_not_ai_user`
- `auth_without_membership`（E2E / RLS fixture 含む）
- `membership_with_roles_no_ai_perms`
- `already_backfilled` / `conflict` / `inactive_account`

メールドメイン（`e2e.*`, `rls.*`）は補助安全策のみ。正式判定は membership + role + permission set。

## コマンド

### Dry-run（デフォルト — 書き込みなし）

```bash
npm run db:backfill-staff
npm run db:backfill-staff -- --json
npm run db:backfill-staff -- --live-target
```

`--live-target` は AI 利用者 1 名について BEFORE → PROPOSED TRANSACTION → EXPECTED AFTER を表示。

### Apply（人間確認後のみ）

```bash
npm run db:backfill-staff -- \
  --apply \
  --auth-user <UUID> \
  --employment-type executive \
  --confirm <token>
```

`--confirm` トークンは dry-run 出力に表示される。`auth_user_id` + `employment_type` から決定論的に生成。

**Apply 前チェックリスト:**

1. dry-run で `backfill_targets: 1` を確認
2. `permission_preservation_preview.ok: true` を確認
3. HR / 管理者が `employment_type` を明示承認
4. マイグレーション 20260831120000 + 20260831121000 が DB に適用済み
5. `--confirm` トークンを dry-run 出力と照合

## Atomic Transaction

Apply は Postgres RPC `regapro_backfill_staff_from_auth` を **1 回の DB トランザクション** で実行。

同一トランザクション内:

1. `regapro_next_staff_no(org_id)` → `staff_no`
2. `INSERT staff`
3. `INSERT staff_identities` (`app_auth`, `regapro_app`)
4. AI permission keys から platform role を導出 → `INSERT staff_role_assignments`
5. 権限 preservation gate（expected platform permissions が全て付与されているか）
6. `INSERT permission_audit_events` × 3（`staff_created`, `identity_linked`, `role_assigned`）

いずれか失敗 → **ROLLBACK ALL**（partial migration 禁止）。

## Platform Role マッピング

Role 名（`admin` 等）ではなく **AI permission key set** から導出:

| AI permission key | Platform role |
|---|---|
| (always) | `platform_base` |
| `chat:use` | `platform_ai_user` |
| `coding:use`, `coding:device_pair`, `coding:workspace_write` | `platform_coding_user` |
| `member:manage`, `organization:manage`, `audit:read`, `system:diagnose` | `platform_admin` |

## Permission Preservation

Apply 前後で以下が変わらないこと:

- AI permission keys（membership_roles 経由 — backfill 後も維持）
- Knowledge clearance（department + clearance_override）
- Platform permissions（legacy bridge → real grants への移行で欠落なし）

RPC 内部でも expected platform permissions の gate あり。欠落時は例外 → rollback。

## Idempotency

| 状況 | 動作 |
|---|---|
| `auth_user_id` に既存 `app_auth` identity | `already_backfilled` — 安全終了 |
| `source_system + external_user_id` 競合 | apply 拒否（例外） |
| `staff_no` 重複 | apply 拒否（UNIQUE 制約） |
| 既存 staff 行 | 上書き禁止 |

## service_role 使用理由

Backfill スクリプト（`scripts/backfill-staff-identities.mjs`）は **独立 maintenance プロセス** として `service_role` を使用:

- dry-run: READ ONLY 監査
- apply: `regapro_backfill_staff_from_auth` 呼び出し（EXECUTE は service_role のみ）

Next.js アプリ API からは呼ばない。通常 authenticated ユーザーから RPC は直接実行不可。

## 禁止事項

- `auth.users` の変更
- membership / role の削除
- 既存 staff の上書き
- `employment_type` の silent fallback（`employee` デフォルト等）
- `staff_no` の手動偽番号生成
- migration 未適用 DB への apply
- 複数 HTTP 呼び出しによる疑似 transaction

## 検証

```bash
npm run db:backfill-staff -- --live-target   # apply 前
npm run db:test-rls                          # apply 後
npm run e2e:release                          # apply 後
```

## 関連

- `docs/architecture/staff-identity.md` — staff_no 採番ルール
- `docs/architecture/rbac-permissions.md` — 二軸権限と LEGACY_PERMISSION_BRIDGE
- `packages/platform/src/staff-backfill.ts` — 分類・マッピング・ preservation ロジック
- `supabase/migrations/20260831121000_staff_backfill_rpc.sql` — atomic RPC
