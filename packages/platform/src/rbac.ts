import type {
  PermissionGrant,
  PermissionScope,
  PermissionScopeType,
  PlatformPermission,
} from "@regapro/shared";
import { ORGANIZATION_SCOPE } from "@regapro/shared";
import { staffFieldsOf, type AccessContext } from "@regapro/security";

/**
 * Permission engine for the Feature Permission axis.
 *
 * Deliberately small: role grants + optional scope + explicit deny overrides.
 * There is no attribute/condition language here — if a rule needs more than a
 * scope anchor it belongs in the owning Application Service, not in RBAC.
 */

/** What a caller is asking to do. Omit `scope` to ask "anywhere at all". */
export type PermissionRequest = {
  permission: PlatformPermission;
  scope?: PermissionScope;
};

export type PermissionDecision = {
  allowed: boolean;
  /** The grant that decided the outcome, when there was one. */
  matched: PermissionGrant | null;
  reason:
    | "allowed"
    | "no_grant"
    | "denied_by_override"
    | "out_of_scope"
    | "staff_inactive";
};

/**
 * Does `grant` cover `requested`?
 *
 * - `organization` covers everything in the org.
 * - `department` / `project` cover the same type, matching id (or any id when
 *   the grant id is `null`).
 * - `self` only ever covers a `self` request for the same staff.
 */
export function scopeCovers(
  grantScope: PermissionScope,
  requested: PermissionScope,
): boolean {
  if (grantScope.type === "organization") return true;
  if (grantScope.type !== requested.type) return false;
  if (grantScope.id === null) return true;
  return grantScope.id === requested.id;
}

function matchesAnyScope(
  grants: PermissionGrant[],
  permission: PlatformPermission,
  effect: "allow" | "deny",
): PermissionGrant | null {
  return (
    grants.find((g) => g.permission === permission && g.effect === effect) ??
    null
  );
}

/**
 * Evaluates one permission request against an access context.
 * Deny overrides always win over allow grants at a covering scope.
 */
export function evaluatePermission(
  ctx: AccessContext,
  request: PermissionRequest,
): PermissionDecision {
  const staff = staffFieldsOf(ctx);

  if (staff.staffStatus !== null && staff.staffStatus !== "active") {
    return { allowed: false, matched: null, reason: "staff_inactive" };
  }

  const grants = staff.permissions;
  // An omitted scope means "any scope I hold"; an explicit scope must be covered.
  const scoped = request.scope !== undefined;
  const requested = request.scope ?? ORGANIZATION_SCOPE;

  const deny = scoped
    ? grants.find(
        (g) =>
          g.permission === request.permission &&
          g.effect === "deny" &&
          scopeCovers(g.scope, requested),
      )
    : matchesAnyScope(grants, request.permission, "deny");

  if (deny) {
    return { allowed: false, matched: deny, reason: "denied_by_override" };
  }

  const allow = scoped
    ? grants.find(
        (g) =>
          g.permission === request.permission &&
          g.effect === "allow" &&
          scopeCovers(g.scope, requested),
      )
    : matchesAnyScope(grants, request.permission, "allow");

  if (allow) return { allowed: true, matched: allow, reason: "allowed" };

  const existsUnscoped = grants.some(
    (g) => g.permission === request.permission && g.effect === "allow",
  );
  return {
    allowed: false,
    matched: null,
    reason: existsUnscoped ? "out_of_scope" : "no_grant",
  };
}

/**
 * Platform API — the only supported way to ask "may this caller do X?".
 *
 * Never re-derive access from `employmentType`, role names, or department keys
 * in UI, routes, API handlers, or AI tools.
 */
export function hasPermission(
  ctx: AccessContext,
  permission: PlatformPermission,
  scope?: PermissionScope,
): boolean {
  return evaluatePermission(ctx, { permission, scope }).allowed;
}

export function hasAnyPermission(
  ctx: AccessContext,
  permissions: readonly PlatformPermission[],
  scope?: PermissionScope,
): boolean {
  return permissions.some((p) => hasPermission(ctx, p, scope));
}

export function hasAllPermissions(
  ctx: AccessContext,
  permissions: readonly PlatformPermission[],
  scope?: PermissionScope,
): boolean {
  return permissions.every((p) => hasPermission(ctx, p, scope));
}

/** Effective allow list, with deny overrides already removed. */
export function listPlatformPermissions(
  ctx: AccessContext,
): PlatformPermission[] {
  const grants = staffFieldsOf(ctx).permissions;
  const denied = new Set(
    grants.filter((g) => g.effect === "deny").map((g) => g.permission),
  );
  const out: PlatformPermission[] = [];
  for (const grant of grants) {
    if (grant.effect !== "allow") continue;
    if (denied.has(grant.permission)) continue;
    if (!out.includes(grant.permission)) out.push(grant.permission);
  }
  return out;
}

export function scopeTypesFor(
  ctx: AccessContext,
  permission: PlatformPermission,
): PermissionScopeType[] {
  const out: PermissionScopeType[] = [];
  for (const grant of staffFieldsOf(ctx).permissions) {
    if (grant.permission !== permission || grant.effect !== "allow") continue;
    if (!out.includes(grant.scope.type)) out.push(grant.scope.type);
  }
  return out;
}

/**
 * Collapses role grants and staff overrides into the grant list stored on an
 * access context. Deny overrides are kept as rows so callers can explain a
 * refusal instead of silently dropping the permission.
 */
export function mergeGrants(
  roleGrants: PermissionGrant[],
  overrides: PermissionGrant[],
): PermissionGrant[] {
  const merged = [...roleGrants];
  for (const override of overrides) {
    const existing = merged.findIndex(
      (g) =>
        g.permission === override.permission &&
        g.scope.type === override.scope.type &&
        (g.scope.id ?? null) === (override.scope.id ?? null),
    );
    if (existing >= 0) merged.splice(existing, 1);
    merged.push(override);
  }
  return merged;
}
