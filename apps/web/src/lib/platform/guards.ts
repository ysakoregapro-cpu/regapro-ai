import "server-only";
import { unstable_rethrow } from "next/navigation";
import type { PermissionScope, PlatformPermission } from "@regapro/shared";
import type { AccessContext } from "@regapro/security";
import {
  requireModuleAccess as requireModuleAccessPure,
  requirePermission as requirePermissionPure,
  type ModuleDefinition,
  type ModuleId,
} from "@regapro/platform";
import { resolveAccessContext } from "./access";

export { platformErrorToAppCode } from "./error-mapping";

/**
 * Security layers 2 and 3.
 *
 * Every server page and route handler that protects a module uses these
 * helpers, so URL entry and direct API calls hit the same decision the sidebar
 * made. Do not re-implement role checks per route.
 */

export type GuardResult = {
  access: AccessContext;
  module: ModuleDefinition;
};

/** Route guard for a whole module. Throws `PlatformAccessError` on refusal. */
export async function requireModuleAccess(
  moduleId: ModuleId,
): Promise<GuardResult> {
  const access = await resolveAccessContext();
  const definition = requireModuleAccessPure(access, moduleId);
  return { access, module: definition };
}

/** Route / service guard for a single capability. */
export async function requirePermission(
  permission: PlatformPermission,
  scope?: PermissionScope,
): Promise<AccessContext> {
  const access = await resolveAccessContext();
  requirePermissionPure(access, permission, scope);
  return access;
}

/** Non-throwing variant for conditional rendering inside an allowed page. */
export async function canAccessModuleAsync(
  moduleId: ModuleId,
): Promise<boolean> {
  try {
    await requireModuleAccess(moduleId);
    return true;
  } catch (err) {
    unstable_rethrow(err);
    return false;
  }
}
