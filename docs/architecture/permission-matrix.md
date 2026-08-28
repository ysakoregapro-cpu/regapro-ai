# Permission Matrix / 権限マトリクス

アプリケーションレベルの権限マトリクス。RLS と Application Service の両方で enforcement する。

## Roles / ロール

| Role | JA | Description |
|---|---|---|
| owner | オーナー | 組織作成者。全権限。削除不可（譲渡必要）。 |
| admin | 管理者 | メンバー管理、設定変更。組織削除不可。 |
| manager | マネージャー | 案件/タスク/成果物の全 CRUD。メンバー管理不可。 |
| member | メンバー | 案件/タスク/調査/成果物の CRUD（自分担当中心）。 |
| viewer | 閲覧者 | 読み取りのみ。 |

## Feature Permissions / 機能別権限

| Feature / 機能 | owner | admin | manager | member | viewer |
|---|---|---|---|---|---|
| **Organization** |
| 組織設定変更 | ✅ | ✅ | ❌ | ❌ | ❌ |
| 組織削除 | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Members** |
| メンバー招待 | ✅ | ✅ | ❌ | ❌ | ❌ |
| ロール変更 | ✅ | ✅ | ❌ | ❌ | ❌ |
| メンバー削除 | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Customers** |
| 閲覧 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 作成/編集 | ✅ | ✅ | ✅ | ✅ | ❌ |
| 削除 | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Projects** |
| 閲覧 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 作成/編集 | ✅ | ✅ | ✅ | ✅ | ❌ |
| 削除 | ✅ | ✅ | ✅ | ❌ | ❌ |
| ステージ変更 | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Tasks** |
| 閲覧 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 作成 | ✅ | ✅ | ✅ | ✅ | ❌ |
| 編集（任意） | ✅ | ✅ | ✅ | ✅ | ❌ |
| 編集（自分担当） | ✅ | ✅ | ✅ | ✅ | ❌ |
| 削除 | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Research** |
| 閲覧 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 調査開始 | ✅ | ✅ | ✅ | ✅ | ❌ |
| ソースピン/メモ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Artifacts** |
| 閲覧 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 作成/編集 | ✅ | ✅ | ✅ | ✅ | ❌ |
| レビュー依頼 | ✅ | ✅ | ✅ | ✅ | ❌ |
| 承認/差戻し | ✅ | ✅ | ✅ | ❌ | ❌ |
| 公開/共有 | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Coding** |
| 貼り付けコード | ✅ | ✅ | ✅ | ✅ | ❌ |
| 端末ペアリング（自分） | ✅ | ✅ | ✅ | ✅ | ❌ |
| Workspace 書き込み | ✅ | ✅ | ✅ | ❌ | ❌ |
| 危険操作の承認 | ✅ | ✅ | ✅ | ❌ | ❌ |
| 端末管理（失効） | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Settings** |
| 外部 AI 設定 | ✅ | ✅ | ❌ | ❌ | ❌ |
| 監査ログ閲覧 | ✅ | ✅ | ❌ | ❌ | ❌ |

## Enforcement Layers / 強制レイヤー

```
1. UI — hide/disable actions user cannot perform
2. Application Service — check role before operation
3. Supabase RLS — database-level enforcement (defense in depth)
```

### Application Service Example

```typescript
function requireRole(member: Member, minimum: Role): void {
  const hierarchy: Role[] = ["viewer", "member", "manager", "admin", "owner"];
  if (hierarchy.indexOf(member.role) < hierarchy.indexOf(minimum)) {
    throw new ForbiddenError("この操作を行う権限がありません。");
  }
}
```

## UI Permission Patterns / UI 権限パターン

- 権限不足: ボタン非表示（disabled ではなく非表示）
- 403 エラー: 「この操作を行う権限がありません。」
- 内部ロール名（owner, admin）は設定画面のみ表示

## Related / 関連

- [RLS Matrix](./rls-matrix.md)
- [ADR 009: Supabase RLS](../adr/009-supabase-rls.md)
