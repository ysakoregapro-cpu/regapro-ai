# RBAC / Feature Permissions / 機能権限

## 二つの名前空間 / Two namespaces

既存の権限テーブルをそのまま再利用し、**キーの名前空間**で軸を分ける。

| 軸 | 記法 | 例 | 経路 |
|---|---|---|---|
| 既存 AI 能力 | コロン | `chat:use`, `knowledge:review` | `organization_memberships` → `membership_roles` |
| 統合アプリ機能 | ドット | `expense.submit`, `admin.access` | `staff` → `staff_role_assignments` |

同じ `permissions` / `roles` / `role_permissions` テーブルに同居するが、キーが衝突せず join 経路も別なので互いに干渉しない。並行するカタログを新設しなかったのは、管理画面・監査・シードを一本化するため。

`chat:use`（AI アシスタント）と `chat.use`（社内チャット）は**別の機能**である点に注意。記法の違いがそのまま意味の違いになっている。

## 権限一覧 / Permission catalog

`packages/shared/src/platform-permissions.ts` が正。

```
ai.use
expense.submit / expense.view_own / expense.manage
sales.view_own / sales.manage
weekly_pay.submit / weekly_pay.manage
chat.use
meeting.use / meeting.manage
coding.use / coding.local_agent
tasks.use / mypage.use
admin.access / admin.staff_manage / admin.role_manage
```

追加手順:

1. `PLATFORM_PERMISSIONS` に追記
2. `PLATFORM_PERMISSION_LABELS` に日本語ラベルを追記
3. マイグレーションで `permissions` に INSERT
4. 必要なら `role_permissions` でロールに割り当て

型が union なので、抜けがあれば `typecheck` が落ちる。

## ロール / Roles

ロールは**権限の名前付き束**にすぎない。職種ごとにロールを作るのではなく、複数を組み合わせる。

`org_id IS NULL` のテンプレートロール:

| キー | 内容 |
|---|---|
| `platform_base` | `mypage.use`, `tasks.use` |
| `platform_ai_user` | `ai.use` |
| `platform_coding_user` | `coding.use`, `coding.local_agent` |
| `platform_expense_submitter` | `expense.submit`, `expense.view_own` |
| `platform_expense_manager` | + `expense.manage` |
| `platform_sales_viewer` | `sales.view_own` |
| `platform_sales_manager` | + `sales.manage` |
| `platform_weekly_pay_submitter` | `weekly_pay.submit` |
| `platform_weekly_pay_manager` | + `weekly_pay.manage` |
| `platform_chat_user` | `chat.use` |
| `platform_meeting_user` / `platform_meeting_manager` | 議事録 |
| `platform_admin` | `admin.access`, `admin.staff_manage`, `admin.role_manage` |

ロール名に雇用形態が入っていないのは意図的。アルバイトにも役員にも同じロールを割り当てられる。

## Scope

過度な ABAC を作らないため、scope は固定 4 種のみ。

| type | `scope_id` | 意味 |
|---|---|---|
| `organization` | NULL | 組織全体 |
| `department` | 部署 ID | その部署のみ |
| `project` | プロジェクト ID | そのプロジェクトのみ |
| `self` | NULL（評価時に自分の `staff_id`） | 自分の行のみ |

判定規則（`scopeCovers()`）:

- `organization` はすべてを覆う。
- `department` / `project` は同種かつ同一 ID のみ（グラント側 ID が NULL なら同種すべて）。
- `self` は `self` の同一 staff のみ。部署要求を満たさない。

`hasPermission(ctx, perm)` のように scope を省略した場合は「どこかで持っていればよい」。行単位の判定では必ず scope を渡す:

```ts
requirePermission(access, "weekly_pay.submit", selfScope(access.staffId));
```

## Override と deny

`staff_permission_overrides` で個別に allow / deny を付けられる。

**deny は常に allow に勝つ。** ロールグラントより優先され、より広い scope の deny は狭い要求も拒否する。deny 行は評価後も残るので、拒否理由を説明できる。

## 評価順序 / Evaluation order

TypeScript（`packages/platform/src/rbac.ts`）と SQL（`regapro_staff_has_permission()`）は同じ順序で判定する:

1. staff が `active` でなければ全拒否
2. 該当 scope を覆う deny override があれば拒否
3. allow override があれば許可
4. ロールグラントがあれば許可
5. それ以外は拒否（`no_grant` / `out_of_scope` を区別して返す）

失効（`expires_at`）と論理削除（`deleted_at`）はどちらの実装でも除外する。

## Platform API

**UI / Route / API / AI Tool が独自にロール判定してはならない。** 次だけを使う。

| 関数 | 場所 | 用途 |
|---|---|---|
| `hasPermission(ctx, perm, scope?)` | `@regapro/platform` | 真偽判定 |
| `requirePermission(ctx, perm, scope?)` | `@regapro/platform` | 例外送出 |
| `requireModuleAccess(ctx, moduleId)` | `@regapro/platform` | モジュール単位 |
| `canViewModule(ctx, module)` | `@regapro/platform` | ナビ表示 |
| `resolveCurrentStaff()` / `resolveAccessContext()` | `apps/web/src/lib/platform` | 解決 |
| `requirePermission()` / `requireModuleAccess()` | `apps/web/src/lib/platform/guards` | Route / Service |
| `withPlatformGuard()` | `apps/web/src/lib/platform/api-guard` | Route Handler |

`@regapro/security` の `hasPermission()` は**別物**（既存 AI 軸、第一引数が `PermissionContext`）。型が違うので取り違えは `typecheck` で落ちる。

## ナビゲーションとの一貫性

ナビ表示（層 1）とルートガード（層 2）は同じ `canViewModule()` を呼ぶ。したがって:

- ナビに出ないモジュールは URL 直打ちでも開けない。
- ナビに出るモジュールは必ず開ける。

例（spec J）: `part_time` + `weekly_pay.submit` の利用者には AI / 週払い / マイページが出て、経費管理・売上管理・管理センターは出ない。社員でも `sales.view_own` がなければ売上は出ない。`employment_type` だけの if 文はコード上に存在しない。

## AI Tool 権限（層 5）

AI が業務データに触れるのは登録された Domain Tool 経由のみ。DB ハンドルは渡さない。

```ts
const registry = createAiToolRegistry([
  {
    name: "weekly_pay.get_my_history",
    moduleId: "weekly_pay",
    requiredPermissions: ["weekly_pay.submit"],
    resolveScope: (_input, access) => ownRecordsScope(access),
    execute: async ({ input, access }) => weeklyPayService.listOwn(access, input),
  },
]);
```

- `listAvailable(access)` — 使える Tool だけをモデルに見せる
- `invoke()` — 権限チェック後に実行。拒否時は本体を呼ばない
- 未知の Tool 名は `FORBIDDEN`（カタログを推測させない）
- `planned` モジュールの Tool は常に `MODULE_UNAVAILABLE`

業務 Tool 自体は今回未実装。インターフェースのみ用意している。

## RLS

管理系ゲートは platform 権限 **または** 既存 AI 権限の両方を受け付ける:

```sql
regapro_can_manage_staff(org)  := admin.staff_manage OR member:manage
regapro_can_manage_roles(org)  := admin.role_manage  OR organization:manage
```

移行中に既存管理者が締め出されるのと、「最初の `platform_admin` を誰も付与できない」ブートストラップデッドロックを避けるため。全管理者が platform ロールを持った時点でレガシー側の条件を外す。

RLS の要点:

- `staff` — 同一組織は参照可。作成・更新は `regapro_can_manage_staff`。
- `staff_identities` — 自分の行のみ参照可。他人の分は `regapro_can_manage_staff` が必要。
- `staff_role_assignments` / `staff_permission_overrides` — 自分の分は参照可。**書き込みは `regapro_can_manage_roles` 必須**（自己昇格の遮断）。
- `permission_audit_events` — 追記専用。UPDATE / DELETE ポリシーなし。
- `migration_*` — 管理者のみ。旧システムの個人情報を含むため。

`service_role` で通常経路を迂回しない。fixture 作成とワーカーのみ。

## 移行フェーズ / Migration phases

| Phase | 内容 | 状態 |
|---|---|---|
| 1 | 追加スキーマ（staff / identity / RBAC / migration 基盤） | マイグレーション作成済み・**未適用** |
| 2 | 現行 AI 利用者 → staff backfill | 未実施 |
| 3 | 互換アダプタで両立運用 | 実装済み（既定動作） |
| 4 | AccessContext を platform グラントへ切替 | 実装済み（staff 連携後に自動的に切替わる） |
| 5 | 旧業務モジュールのデータ移行 | 未実施 |

Phase 3 → 4 の切替は利用者単位で自動的に起きる。`staff_id` が付いた瞬間、その人だけ実グラント評価に移る。一斉切替（cutover）は不要かつ禁止。
