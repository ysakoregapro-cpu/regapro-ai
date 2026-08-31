import "server-only";
import type { NextRequest } from "next/server";
import type { PermissionScope, PlatformPermission } from "@regapro/shared";
import type { AccessContext } from "@regapro/security";
import {
  isPlatformAccessError,
  requireModuleAccess as requireModuleAccessPure,
  requirePermission as requirePermissionPure,
  type ModuleId,
} from "@regapro/platform";
import { catchToJson, jsonError } from "@/lib/application/api-errors";
import { resolveAccessContext } from "./access";
import { platformErrorToAppCode } from "./error-mapping";

/**
 * Security layer 3 — API / server action guard.
 *
 * Wrapping a handler is the supported way to protect a route; it guarantees the
 * permission check runs before any body parsing or data access, and that
 * refusals return the same shape as the rest of the API.
 */

export type GuardedHandler<TContext = unknown> = (args: {
  request: NextRequest;
  access: AccessContext;
  context: TContext;
}) => Promise<Response>;

export type ApiGuardOptions = {
  moduleId?: ModuleId;
  permission?: PlatformPermission;
  permissionScope?: PermissionScope;
};

export function withPlatformGuard<TContext = unknown>(
  options: ApiGuardOptions,
  handler: GuardedHandler<TContext>,
): (request: NextRequest, context: TContext) => Promise<Response> {
  return async (request, context) => {
    let access: AccessContext;
    try {
      access = await resolveAccessContext();
    } catch (err) {
      return catchToJson(err);
    }

    try {
      if (options.moduleId) {
        requireModuleAccessPure(access, options.moduleId);
      }
      if (options.permission) {
        requirePermissionPure(access, options.permission, options.permissionScope);
      }
    } catch (err) {
      const code = platformErrorToAppCode(err);
      if (code) {
        return jsonError(code, undefined, {
          log: isPlatformAccessError(err)
            ? `${err.code} module=${err.moduleId ?? "-"} permission=${err.permission ?? "-"}`
            : undefined,
        });
      }
      return catchToJson(err);
    }

    try {
      return await handler({ request, access, context });
    } catch (err) {
      return catchToJson(err);
    }
  };
}
