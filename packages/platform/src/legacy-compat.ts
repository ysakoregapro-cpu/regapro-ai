import type {
  Permission,
  PermissionGrant,
  PlatformPermission,
} from "@regapro/shared";
import { ORGANIZATION_SCOPE } from "@regapro/shared";
import { staffFieldsOf, type AccessContext } from "@regapro/security";

/**
 * Compatibility adapter: legacy AI capability keys → Feature Permission axis.
 *
 * Until every user has a `staff_id` with platform role assignments, the
 * integrated shell derives feature permissions from the AI permissions the user
 * already holds. This keeps the AI product working unchanged while the staff
 * backfill runs, and it is what makes the migration non-destructive.
 *
 * Once `staff_role_assignments` exist for a staff member, real grants take over
 * and this adapter is bypassed — see `docs/architecture/rbac-permissions.md`.
 */
export const LEGACY_PERMISSION_BRIDGE: Partial<
  Record<Permission, readonly PlatformPermission[]>
> = {
  "chat:use": ["ai.use"],
  "task:read": ["tasks.use"],
  "coding:use": ["coding.use"],
  "coding:device_pair": ["coding.local_agent"],
  "coding:workspace_write": ["coding.local_agent"],
  "member:manage": ["admin.access", "admin.staff_manage"],
  "organization:manage": [
    "admin.access",
    "admin.staff_manage",
    "admin.role_manage",
  ],
  "audit:read": ["admin.access"],
  "system:diagnose": ["admin.access"],
};

/** Every authenticated person can reach their own page. */
const BASELINE_PERMISSIONS: readonly PlatformPermission[] = ["mypage.use"];

/**
 * Builds organization-scoped grants from the legacy `permissionKeys` already on
 * an access context. Never widens access: it only restates capabilities the
 * caller demonstrably holds on the AI axis.
 */
export function derivePlatformGrantsFromLegacy(
  ctx: Pick<AccessContext, "permissionKeys">,
): PermissionGrant[] {
  const permissions = new Set<PlatformPermission>(BASELINE_PERMISSIONS);
  for (const legacy of ctx.permissionKeys) {
    for (const mapped of LEGACY_PERMISSION_BRIDGE[legacy] ?? []) {
      permissions.add(mapped);
    }
  }
  return [...permissions].map((permission) => ({
    permission,
    scope: ORGANIZATION_SCOPE,
    effect: "allow" as const,
    source: "legacy_compat" as const,
    roleId: null,
  }));
}

/**
 * Returns the grants to evaluate against: real staff grants when the caller is
 * linked to staff, otherwise the legacy-derived set.
 */
export function effectiveGrants(ctx: AccessContext): PermissionGrant[] {
  const staff = staffFieldsOf(ctx);
  if (staff.staffId !== null) return staff.permissions;
  return derivePlatformGrantsFromLegacy(ctx);
}

/**
 * Fills the platform fields of an access context that has none, so callers can
 * run the same permission engine in both phases of the migration.
 */
export function withLegacyCompatibilityGrants(
  ctx: AccessContext,
): AccessContext {
  const staff = staffFieldsOf(ctx);
  if (staff.staffId !== null) return ctx;
  const permissions = derivePlatformGrantsFromLegacy(ctx);
  return {
    ...ctx,
    authUserId: staff.authUserId,
    staffId: null,
    permissions,
    scopes: [ORGANIZATION_SCOPE],
    departmentIds: staff.departmentIds,
    roleIds: staff.roleIds,
  };
}
