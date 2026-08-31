# Integrated App Foundation v1 / 統合アプリ基盤

Regalo Professional の社内統合アプリを、既存の RegaloProfessional AI と**同じ基盤の上に**安全に積み上げるための土台。

このドキュメントは全体像を示す。詳細は次を参照:

- 人の同一性: [`staff-identity.md`](./staff-identity.md)
- 権限モデル: [`rbac-permissions.md`](./rbac-permissions.md)
- 旧システム取り込み: [`../operations/legacy-identity-migration.md`](../operations/legacy-identity-migration.md)

## 何を作ったか / Scope of v1

作ったのは**基盤だけ**。経費・売上・週払いの業務機能そのものは実装していない。

| 追加したもの | 置き場所 |
|---|---|
| Staff / Identity / RBAC スキーマ | `supabase/migrations/2026082812*.sql` |
| 権限エンジン・Module Registry・ガード | `packages/platform` |
| Staff・Permission の型 | `packages/shared/src/staff.ts`, `platform-permissions.ts` |
| AccessContext の追加フィールド | `packages/security/src/index.ts` |
| Staff 解決・ガード・ナビ生成 | `apps/web/src/lib/platform/` |

既存の AI Runtime / Internal Knowledge / Web Intelligence / Citation / Knowledge Factory / Research / Security / RLS / Conversation / Coding Runtime / Local Agent / Playwright には**破壊的変更を加えていない**。

## 二つの軸を混ぜない / Two independent axes

これが本基盤で最も重要な設計判断。

| 軸 | 問い | 型 | 保管先 |
|---|---|---|---|
| **Feature Permission** | どの機能を開いてよいか | `PlatformPermission`（`expense.submit` 形式） | `staff_role_assignments` |
| **Knowledge Clearance** | どの機密情報を読んでよいか | `ConfidentialityLevel` + `Visibility` | `organization_memberships.clearance_override` ほか |

アルバイトが `weekly_pay.submit` を持ちつつ最低区分ということも、役員が `executive` 区分を持ちつつ `expense.manage` を持たないこともある。**片方からもう片方を導出してはならない。**

`packages/platform/src/legacy-compat.test.ts` の "Feature Permission and Knowledge Clearance are independent axes" がこれを機械的に守っている。

同様に **employment_type から権限を決めない**。`employment_type` は契約形態を表すだけで、権限判定関数のどこにも登場しない。

## レイヤ構成 / Layers

```
UI (React)
  ↓ Module Registry + Permission Engine で表示を決める
Application Service / Route Guard / API Guard
  ↓ 同じ Permission Engine で拒否する
Domain
  ↓
Repository / Provider
  ↓
Supabase RLS  ← 最終的な権威
```

UI は Repository / Provider を直接呼ばない。AI は Domain Tool 経由でしか業務データに触れない。

## セキュリティ 5 層 / Security layers

| 層 | 実装 | 目的 |
|---|---|---|
| 1. UI 表示 | `buildNavigation()` → `AppShell` | 使えないものを見せない |
| 2. Route Guard | `requireModuleAccess()`（例: `app/(app)/admin/layout.tsx`） | URL 直打ちを止める |
| 3. API Guard | `withPlatformGuard()` / `requirePermission()` | API 直叩きを止める |
| 4. RLS | `regapro_staff_has_permission()` ほか | DB が最後に拒否する |
| 5. AI Tool | `createAiToolRegistry()` | AI に無制限アクセスを渡さない |

層 1 と層 2 は**同じ述語** `canViewModule()` を使う。ナビに出ないものは URL でも開けない、が構造として保証される。

## Module Registry

`packages/platform/src/modules.ts` が統合アプリの目次。ナビ・ダッシュボード・モバイルナビ・ルートガード・API ガードがすべてここを読む。

各モジュールは次を宣言する:

```
id / label / routes / primaryRoute / navigationGroup / parentModuleId
iconRef / requiredPermissions / permissionMode
dashboardVisibility / mobileVisibility / featureState / order
```

`featureState`:

- `available` — 出荷済み。ナビに出る、ルーティングできる。
- `planned` — **登録だけ**。どこにも出ず、ガードは常に拒否する。
- `disabled` — 出荷済みだがこの環境では停止。

Expense / Sales / WeeklyPay / Chat / Meeting / Coding は現在 `planned`。権限を持っていても画面には出ないし、`requireModuleAccess()` は `MODULE_UNAVAILABLE` で拒否する。実装が乗ったときに `featureState` を `available` にするだけでナビ・ガード・モバイル対応が一斉に有効になる。

## ユーザーから見える構造 / User-facing IA

一般ユーザーに見せる概念は次だけ:

```
ホーム / アシスタント / タスク / 検索 / ワークスペース
業務（権限に応じて 経費・売上・週払い）
マイページ
```

必要なユーザーにだけ: コーディング / 管理センター

内部名（Repository, Provider, Worker, Pipeline, RAG）は UI に出さない。`iconRef` が文字列なのも、Registry を UI フレームワークから独立させて server / test の両方で読めるようにするため。

## 互換モード / Compatibility mode

`staff_id` に紐づいていない利用者は**互換モード**で動く。

- `resolveCurrentStaff()` が `null` を返す（テーブル未適用でも同じ）。
- `derivePlatformGrantsFromLegacy()` が既存 AI 権限から Feature Permission を導出する（`chat:use` → `ai.use` など）。
- 既に出荷済みのモジュールは `legacyFallbackVisible` で表示を維持する。

つまり **マイグレーション適用前にこのコードを出しても挙動は変わらない**。段階移行は [`rbac-permissions.md`](./rbac-permissions.md#移行フェーズ--migration-phases) を参照。

## 監査 / Audit

`permission_audit_events` に who / subject / action / before / after / timestamp を追記専用で残す。UPDATE / DELETE ポリシーは意図的に存在しない。

## 今回作っていないもの / Explicitly out of scope

- 経費・売上・週払いの画面と API
- 旧システムからの本番データ移行
- 汎用 ABAC エンジン（scope は 4 種類の固定集合のみ）
- Meeting / Chat の実装（Registry への登録のみ）
- AI 業務 Domain Tool の実装（インターフェースのみ）
