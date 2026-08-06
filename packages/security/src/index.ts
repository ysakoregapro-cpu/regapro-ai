import type { Permission, Role, Visibility } from "@regapro/shared";
import { ROLE_PERMISSIONS } from "@regapro/shared";

export interface PermissionContext {
  roles: Role[];
  extraPermissions?: Permission[];
}

export function hasPermission(
  ctx: PermissionContext,
  permission: Permission,
): boolean {
  if (ctx.extraPermissions?.includes(permission)) return true;
  return ctx.roles.some((role) => ROLE_PERMISSIONS[role].includes(permission));
}

export function listEffectivePermissions(ctx: PermissionContext): Permission[] {
  const set = new Set<Permission>(ctx.extraPermissions ?? []);
  for (const role of ctx.roles) {
    for (const p of ROLE_PERMISSIONS[role]) set.add(p);
  }
  return [...set];
}

export interface VisibilityContext {
  visibility: Visibility;
  userId: string;
  ownerId: string;
  teamMemberIds?: string[];
  departmentMemberIds?: string[];
  projectMemberIds?: string[];
  organizationMemberIds?: string[];
}

const VISIBILITY_RANK: Record<Visibility, number> = {
  private: 0,
  team: 1,
  department: 2,
  project: 3,
  organization: 4,
};

export function canAccessByVisibility(ctx: VisibilityContext): boolean {
  switch (ctx.visibility) {
    case "private":
      return ctx.userId === ctx.ownerId;
    case "team":
      return (
        ctx.userId === ctx.ownerId ||
        (ctx.teamMemberIds?.includes(ctx.userId) ?? false)
      );
    case "department":
      return (
        ctx.userId === ctx.ownerId ||
        (ctx.departmentMemberIds?.includes(ctx.userId) ?? false)
      );
    case "project":
      return (
        ctx.userId === ctx.ownerId ||
        (ctx.projectMemberIds?.includes(ctx.userId) ?? false)
      );
    case "organization":
      return (
        ctx.userId === ctx.ownerId ||
        (ctx.organizationMemberIds?.includes(ctx.userId) ?? false)
      );
    default:
      return false;
  }
}

export function isVisibilityAtLeast(
  current: Visibility,
  required: Visibility,
): boolean {
  return (VISIBILITY_RANK[current] ?? 0) >= (VISIBILITY_RANK[required] ?? 0);
}

/** Mirrors SQL helper: auth.uid() membership check (documentation-only). */
export function rlsDocMembershipCheck(
  userId: string | null,
  memberUserIds: string[],
): boolean {
  return userId !== null && memberUserIds.includes(userId);
}

/** Mirrors SQL helper: org-scoped row access (documentation-only). */
export function rlsDocOrgScopedAccess(
  rowOrgId: string,
  userOrgIds: string[],
): boolean {
  return userOrgIds.includes(rowOrgId);
}

const FORBIDDEN_PATH = /\.\.|\/\\|^\/|^\\|:|\0/;

export function isSafeStoragePath(path: string): boolean {
  if (!path || path.length > 1024) return false;
  if (FORBIDDEN_PATH.test(path)) return false;
  const segments = path.split("/").filter(Boolean);
  return segments.every((s) => s !== "." && s !== "..");
}

export function normalizeStoragePath(path: string): string {
  if (!isSafeStoragePath(path)) {
    throw new Error("Unsafe storage path");
  }
  return path.split("/").filter(Boolean).join("/");
}
