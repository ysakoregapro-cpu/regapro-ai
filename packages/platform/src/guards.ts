import type { PermissionScope, PlatformPermission } from "@regapro/shared";
import { staffFieldsOf, type AccessContext } from "@regapro/security";
import {
  getModule,
  isModuleRoutable,
  type ModuleDefinition,
  type ModuleId,
} from "./modules.js";
import { evaluatePermission, hasAllPermissions, hasAnyPermission } from "./rbac.js";
import { withLegacyCompatibilityGrants } from "./legacy-compat.js";
import { canViewModule } from "./navigation.js";

/**
 * Shared guards for security layers 2 (route), 3 (API / server action), and
 * 5 (AI tool). Layer 1 is navigation visibility and layer 4 is Supabase RLS.
 *
 * Routes must not hand-roll their own role checks — that is how UI-hidden
 * features become reachable by typing a URL.
 */

export type PlatformDenialCode =
  | "STAFF_INACTIVE"
  | "FORBIDDEN"
  | "MODULE_UNAVAILABLE";

export class PlatformAccessError extends Error {
  readonly code: PlatformDenialCode;
  readonly permission: PlatformPermission | null;
  readonly moduleId: ModuleId | null;

  constructor(input: {
    code: PlatformDenialCode;
    message: string;
    permission?: PlatformPermission | null;
    moduleId?: ModuleId | null;
  }) {
    super(input.message);
    this.name = "PlatformAccessError";
    this.code = input.code;
    this.permission = input.permission ?? null;
    this.moduleId = input.moduleId ?? null;
  }
}

/** User-facing copy. Never leaks permission keys or table names. */
export function denialMessage(code: PlatformDenialCode): string {
  switch (code) {
    case "STAFF_INACTIVE":
      return "現在このアカウントは利用できません。管理者にお問い合わせください。";
    case "MODULE_UNAVAILABLE":
      return "この機能はまだ利用できません。";
    default:
      return "この機能を利用する権限がありません。";
  }
}

/**
 * Platform API — throws when the caller may not perform `permission`.
 * Pass `scope` for row-level asks such as "their own weekly pay".
 */
export function requirePermission(
  ctx: AccessContext,
  permission: PlatformPermission,
  scope?: PermissionScope,
): void {
  const resolved = withLegacyCompatibilityGrants(ctx);
  const decision = evaluatePermission(resolved, { permission, scope });
  if (decision.allowed) return;

  const code: PlatformDenialCode =
    decision.reason === "staff_inactive" ? "STAFF_INACTIVE" : "FORBIDDEN";
  throw new PlatformAccessError({
    code,
    message: denialMessage(code),
    permission,
  });
}

export function requireAnyPermission(
  ctx: AccessContext,
  permissions: readonly PlatformPermission[],
  scope?: PermissionScope,
): void {
  if (permissions.length === 0) return;
  const resolved = withLegacyCompatibilityGrants(ctx);
  if (hasAnyPermission(resolved, permissions, scope)) return;
  throw new PlatformAccessError({
    code: "FORBIDDEN",
    message: denialMessage("FORBIDDEN"),
    permission: permissions[0] ?? null,
  });
}

export function requireAllPermissions(
  ctx: AccessContext,
  permissions: readonly PlatformPermission[],
  scope?: PermissionScope,
): void {
  if (permissions.length === 0) return;
  const resolved = withLegacyCompatibilityGrants(ctx);
  if (hasAllPermissions(resolved, permissions, scope)) return;
  throw new PlatformAccessError({
    code: "FORBIDDEN",
    message: denialMessage("FORBIDDEN"),
    permission: permissions[0] ?? null,
  });
}

/**
 * Route-level guard. Uses the same predicate as navigation, so a module hidden
 * from the sidebar cannot be opened by typing its URL.
 */
export function requireModuleAccess(
  ctx: AccessContext,
  moduleId: ModuleId,
): ModuleDefinition {
  const module = getModule(moduleId);

  if (!isModuleRoutable(module)) {
    throw new PlatformAccessError({
      code: "MODULE_UNAVAILABLE",
      message: denialMessage("MODULE_UNAVAILABLE"),
      moduleId,
    });
  }

  const staff = staffFieldsOf(ctx);
  if (staff.staffStatus !== null && staff.staffStatus !== "active") {
    throw new PlatformAccessError({
      code: "STAFF_INACTIVE",
      message: denialMessage("STAFF_INACTIVE"),
      moduleId,
    });
  }

  if (!canViewModule(ctx, module)) {
    throw new PlatformAccessError({
      code: "FORBIDDEN",
      message: denialMessage("FORBIDDEN"),
      moduleId,
    });
  }

  return module;
}

export function isPlatformAccessError(err: unknown): err is PlatformAccessError {
  return err instanceof PlatformAccessError;
}
