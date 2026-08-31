# RLS Matrix / RLS マトリクス

Supabase Row-Level Security の実装マップ。マイグレーションが正であり、本ドキュメントはその要約である。架空の helper や存在しないロール階層は記載しない。

## 原則 / Principles

1. **すべてのテナントスコープテーブルで RLS を有効化**する。
2. **default privileges に依存しない**。`authenticated` / `service_role` への **明示 `GRANT`** がないと、RLS 以前に操作が拒否される。
3. **`GRANT` は RLS ポリシーが許す最小権限**に合わせる（例: SELECT ポリシーしかない表には `SELECT` だけ）。
4. **通常のユーザージャーニーで `service_role` を迂回しない**。ワーカー・fixture・移行バッチのみ。
5. **ロール名の大小比較はしない**。判定は `permissions.key`（permission key）と helper 関数で行う。

## 二つの権限軸 / Two permission axes

| 軸 | 記法 | カタログ | 付与経路 | RLS で主に使う関数 |
|---|---|---|---|---|
| **既存 AI 能力**（Feature Permission） | コロン `chat:use` | `permissions` / `roles` / `role_permissions` | `organization_memberships` → `membership_roles` | `regapro_has_permission(org, key)` |
| **統合アプリ機能**（Platform Feature Permission） | ドット `expense.submit` | 同上テーブル（キー空間が別） | `staff` → `staff_role_assignments`（+ overrides） | `regapro_staff_has_permission(org, key)` |
| **Knowledge Clearance**（別軸） | レベル文字列 | 機密ラベル列 + clearance 関数 | membership の clearance 設定 | `regapro_effective_clearance_level`, `regapro_can_access_confidentiality_level`, `regapro_can_access_resource` 等 |

**Feature Permission と Knowledge Clearance は別判定。** チャット・タスク・成果物・ナレッジ行など「ラベル付きリソース」は、組織メンバーであることに加え clearance / visibility helper を通す（`20260806120000_confidentiality_model.sql`）。

Platform 権限の詳細は [RBAC / Feature Permissions](./rbac-permissions.md)。アプリ権限マトリクスは [Permission Matrix](./permission-matrix.md)（UI 向け要約; **owner ロールは DB に存在しない**）。

## アプリケーション層 / AccessContext

サーバーは `@regapro/security` の `AccessContext` を解決してから操作する。

| フィールド | 意味 |
|---|---|
| `userId` | `auth.users.id`（ログイン ID） |
| `organizationId` | 現在の組織 |
| `permissionKeys` | AI 軸の permission key 一覧（`membership_roles` 経由） |
| `staffId` | 正規の人物 ID（`staff_identities` 経由; 未連携なら `null`） |
| `permissions` | Platform 軸の `PermissionGrant[]`（staff 連携後） |
| `scopes` | 部署・プロジェクト・self 等 |

`staffId === null` の移行期間は `derivePlatformGrantsFromLegacy()` が AI `permissionKeys` を Platform 権限へ写像する（`packages/platform/src/legacy-compat.ts`）。staff 連携後は実グラントが優先される。

UI / Route / API は **permission key ベース**（`hasPermission`, `requirePermission`, `requireModuleAccess`）を使い、ロール名の if 文は使わない。

## カタログテーブル / RBAC catalog

| テーブル | 用途 |
|---|---|
| `permissions` | 権限キー（`key`, `label`） |
| `roles` | ロール（`org_id` NULL = グローバルテンプレート） |
| `role_permissions` | ロール ↔ 権限 |
| `membership_roles` | AI 軸: membership ↔ ロール |
| `staff_role_assignments` | Platform 軸: staff ↔ ロール（scope 付き） |
| `staff_permission_overrides` | 個別 allow / deny（deny が優先） |
| `permission_audit_events` | 権限変更監査（追記専用） |

テンプレートロール例（`org_id IS NULL`）: `member`, `editor`, `manager`, `admin`。**`owner` はシードにない。**

## RLS helper 関数 / Helper functions

以下はマイグレーションで定義された実関数。`auth_org_ids()` や `auth_member_role()` は **存在しない**。

| 関数 | 用途 | SECURITY DEFINER | `search_path` |
|---|---|---|---|
| `regapro_current_user_id()` | `auth.uid()` のエイリアス | いいえ | — |
| `regapro_is_org_member(org)` | 有効な `organization_memberships` | はい | `public` |
| `regapro_has_permission(org, key)` | AI 軸 permission key | はい | `public` |
| `regapro_current_membership_id(org)` | membership ID | はい | `public` |
| `regapro_is_active_org_member(org)` | アクティブメンバー | はい | `public` |
| `regapro_is_project_member(project)` | プロジェクトメンバー | はい | `public` |
| `regapro_current_staff_id()` | `auth.uid()` → `staff_id` | いいえ | — |
| `regapro_staff_belongs_to_org(org)` | staff が組織に所属 | いいえ | — |
| `regapro_can_read_org(org)` | staff 読取 or AI メンバー | いいえ | — |
| `regapro_staff_has_permission(org, key)` | Platform 軸 permission key | はい | `public` |
| `regapro_can_manage_staff(org)` | `admin.staff_manage` **または** `member:manage` | はい | `public` |
| `regapro_can_manage_roles(org)` | `admin.role_manage` **または** `organization:manage` | はい | `public` |
| `regapro_effective_clearance_level(org)` | ユーザーの clearance レベル | はい | `public` |
| `regapro_can_access_confidentiality_level(...)` | 行の機密レベル vs clearance | はい | `public` |
| `regapro_can_access_resource(...)` | ラベル付きリソース統合判定 | はい | `public` |
| `regapro_can_access_thread(thread)` | スレッドアクセス | はい | `public` |
| `regapro_can_read_private_thread(thread)` | プライベートスレッド | はい | `public` |

SECURITY DEFINER 関数は `REVOKE ALL FROM PUBLIC` のうえ `GRANT EXECUTE TO authenticated`（必要なら `service_role`）する。新規関数追加時も同パターン。

## ポリシーパターン / Policy patterns

### 非ラベルリソース

`projects` など機密ラベル列を持たない表は、多くが `regapro_is_org_member(org_id)` による SELECT。更新系は該当 permission key（例: `project:manage`, `member:manage`）。

### ラベル付きリソース

`chat_threads`, `tasks`, `artifacts`, `knowledge_*`, `research_*`, `file_objects` 等は **default-deny**。`regapro_can_access_resource` / `regapro_can_access_labeled_row` と visibility・clearance を組み合わせる（`20260806120000_confidentiality_model.sql`）。

### 監査ログ

`audit_logs`: SELECT は `regapro_has_permission(org, 'audit:read')`。INSERT はユーザーポリシーなし（アプリ / ワーカー経路）。

### Platform / staff（Integrated App Foundation）

| テーブル | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `staff` | 同一組織 or 管理 | `regapro_can_manage_staff` | 同上 | — |
| `staff_identities` | 自分 or 管理 | 管理 | 管理 | — |
| `staff_departments` | 同一組織 | 管理 | 管理 | — |
| `staff_role_assignments` | 自分 or 管理 | `regapro_can_manage_roles` | 同上 | 同上 |
| `staff_permission_overrides` | 自分 or 管理 | `regapro_can_manage_roles` | 同上 | 同上 |
| `permission_audit_events` | 管理 | 管理 | — | — |
| `migration_*` | 管理 | 管理 | 管理 | 管理 |

移行ブリッジ: `regapro_can_manage_staff` / `regapro_can_manage_roles` は Platform 権限に加え **レガシー AI 権限**（`member:manage`, `organization:manage`）も受け付ける。全管理者が Platform ロールを持った後にレガシー条件を外す計画（[rbac-permissions.md](./rbac-permissions.md)）。

## Coding Agent Runtime（`coding_*`）

権限キー（AI 軸）: `coding:use`, `coding:device_pair`, `coding:workspace_write`, `coding:dangerous_approve`, `coding:device_manage`（`permissions` シード + テンプレートロール）。

RLS は **端末所有者（`user_id = auth.uid()`）** ベース。ロール名では判定しない。

| テーブル | SELECT | INSERT | UPDATE | DELETE | 備考 |
|---|---|---|---|---|---|
| `coding_devices` | 自分の端末 + org member | 自分 | 自分 | — | |
| `coding_pairing_challenges` | 自分 | 自分 | — | — | `consumed_at` 更新ポリシーは未定义 |
| `coding_workspaces` | 自分 | 自分 | 自分 | — | |
| `coding_runs` | 自分 | 自分 | 自分 | — | メタデータのみ保存 |
| `coding_commands` | 自分の端末に紐づく行 | — | — | — | キュー書き込みは現状ポリシーなし |
| `coding_approvals` | 自分 | 自分 | 自分 | — | |
| `coding_audit_events` | `audit:read` + org member | — | — | — | 追記ポリシーなし |

明示 GRANT（`20260828123000_coding_runtime_grants.sql`）は上表に合わせる:

- `authenticated`: 各表でポリシーが許す操作のみ（`coding_commands` / `coding_audit_events` は `SELECT` のみ）
- `service_role`: `ALL`（ワーカー / fixture）

現行 Web API（`coding-device-store`）は in-memory 実装だが、DB 接続時は JWT + 上記 GRANT / RLS が必要。

## Service Role 使用 / Service role usage

| プロセス | 用途例 |
|---|---|
| Research / Knowledge ワーカー | ジョブ claim、チャンク書き込み、検索 RPC のバックフィル |
| Cron / バックグラウンド | 監査追記、通知配送 |
| 移行バッチ | `migration_*` への一括投入 |
| テスト fixture | RLS 統合テストのセットアップ |

**クライアントバンドルや `NEXT_PUBLIC_*` に `service_role` を出さない。**

## テスト / Testing RLS

```bash
npm run db:test-rls
```

`scripts/rls-integration/` が JWT コンテキスト付きでケースを実行。Platform / staff テーブルはマイグレーション未適用環境では `skip` する。

手動確認例:

```sql
SET request.jwt.claims = '{"sub": "user-uuid-here", "role": "authenticated"}';
SELECT * FROM public.projects;
```

## 関連 / Related

- [RBAC / Feature Permissions](./rbac-permissions.md) — Platform 軸、評価順序、legacy bridge
- [Staff Identity](./staff-identity.md) — `staff_id` とログイン ID の分離
- [Permission Matrix](./permission-matrix.md) — UI 向け機能マトリクス（要更新の場合は実装と突合）
- [ADR 009: Supabase RLS](../adr/009-supabase-rls.md)
