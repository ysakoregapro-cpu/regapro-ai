import { z } from "zod";

/**
 * Feature Permission axis for the integrated app.
 *
 * This is a DIFFERENT AXIS from Knowledge Clearance (`confidentiality.ts`) and
 * from resource Visibility (`visibility.ts`):
 *
 *   Feature Permission  → *which features may I open / operate*
 *   Knowledge Clearance → *which classified content may I read*
 *
 * A part-time worker may hold `weekly_pay.submit` while having the lowest
 * clearance; an executive may have `executive` clearance while holding no
 * `expense.manage`. Never derive one axis from the other.
 *
 * Keys use dot notation (`module.action`) to stay distinct from the legacy
 * AI-runtime capability keys in `permissions.ts`, which use colon notation
 * (`chat:use`). Both live in the `permissions` table; the namespaces do not
 * collide and `legacy-compat` bridges between them during migration.
 */

export const PLATFORM_PERMISSIONS = [
  "ai.use",

  "expense.submit",
  "expense.view_own",
  "expense.manage",

  "sales.view_own",
  "sales.manage",

  "weekly_pay.submit",
  "weekly_pay.manage",

  "chat.use",

  "meeting.use",
  "meeting.manage",

  "coding.use",
  "coding.local_agent",

  "tasks.use",
  "mypage.use",

  "admin.access",
  "admin.staff_manage",
  "admin.role_manage",
] as const;

export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

export const PlatformPermissionSchema = z.enum(PLATFORM_PERMISSIONS);

export function isPlatformPermission(key: string): key is PlatformPermission {
  return (PLATFORM_PERMISSIONS as readonly string[]).includes(key);
}

/** Adding a permission = append to `PLATFORM_PERMISSIONS` + insert a `permissions` row. */
export const PLATFORM_PERMISSION_LABELS: Record<PlatformPermission, string> = {
  "ai.use": "AIを使う",
  "expense.submit": "経費を申請する",
  "expense.view_own": "自分の経費を見る",
  "expense.manage": "経費を管理する",
  "sales.view_own": "自分の売上を見る",
  "sales.manage": "売上を管理する",
  "weekly_pay.submit": "週払いを申請する",
  "weekly_pay.manage": "週払いを管理する",
  "chat.use": "社内チャットを使う",
  "meeting.use": "議事録を使う",
  "meeting.manage": "議事録を管理する",
  "coding.use": "コーディングを使う",
  "coding.local_agent": "ローカル端末連携を使う",
  "tasks.use": "タスクを使う",
  "mypage.use": "マイページを使う",
  "admin.access": "管理センターを開く",
  "admin.staff_manage": "スタッフを管理する",
  "admin.role_manage": "ロールと権限を管理する",
};

/**
 * Scope narrows where a grant applies. Deliberately a small fixed set —
 * this is not a general ABAC engine.
 */
export const PERMISSION_SCOPE_TYPES = [
  "organization",
  "department",
  "project",
  "self",
] as const;
export type PermissionScopeType = (typeof PERMISSION_SCOPE_TYPES)[number];

export const PermissionScopeTypeSchema = z.enum(PERMISSION_SCOPE_TYPES);

/**
 * `id` is the scope anchor: department id, project id, or staff id.
 * `null` means "unbounded within this scope type" (always the case for
 * `organization`, and used by `self` to mean "the caller").
 */
export type PermissionScope = {
  type: PermissionScopeType;
  id: string | null;
};

export const ORGANIZATION_SCOPE: PermissionScope = {
  type: "organization",
  id: null,
};

export function selfScope(staffId: string | null): PermissionScope {
  return { type: "self", id: staffId };
}

export function departmentScope(departmentId: string): PermissionScope {
  return { type: "department", id: departmentId };
}

export function projectScope(projectId: string): PermissionScope {
  return { type: "project", id: projectId };
}

export function formatScope(scope: PermissionScope): string {
  return scope.id ? `${scope.type}:${scope.id}` : scope.type;
}

export function scopesEqual(a: PermissionScope, b: PermissionScope): boolean {
  return a.type === b.type && (a.id ?? null) === (b.id ?? null);
}

export type PermissionEffect = "allow" | "deny";

export type PermissionGrantSource = "role" | "override" | "legacy_compat";

/** One evaluated permission entry on an access context. */
export type PermissionGrant = {
  permission: PlatformPermission;
  scope: PermissionScope;
  effect: PermissionEffect;
  source: PermissionGrantSource;
  /** Role that produced the grant, when `source === "role"`. */
  roleId?: string | null;
};

export function allowGrant(
  permission: PlatformPermission,
  scope: PermissionScope = ORGANIZATION_SCOPE,
  source: PermissionGrantSource = "role",
  roleId: string | null = null,
): PermissionGrant {
  return { permission, scope, effect: "allow", source, roleId };
}

export function denyGrant(
  permission: PlatformPermission,
  scope: PermissionScope = ORGANIZATION_SCOPE,
): PermissionGrant {
  return { permission, scope, effect: "deny", source: "override", roleId: null };
}
