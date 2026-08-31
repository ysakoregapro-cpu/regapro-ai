import { isStaffCompatibilityMode, type AccessContext } from "@regapro/security";
import {
  MODULE_REGISTRY,
  isModuleRoutable,
  type ModuleDefinition,
  type ModuleId,
  type NavigationGroup,
} from "./modules.js";
import { hasAllPermissions, hasAnyPermission } from "./rbac.js";
import { withLegacyCompatibilityGrants } from "./legacy-compat.js";

/**
 * Navigation, dashboard shortcuts, and mobile nav are all generated from the
 * Module Registry plus the permission engine. There is exactly one visibility
 * rule, so a hidden module is hidden everywhere at once.
 */

export type NavigationSurface = "desktop" | "mobile" | "dashboard";

export type NavigationItem = {
  moduleId: ModuleId;
  label: string;
  href: string;
  iconRef: string;
  group: NavigationGroup;
};

export type NavigationModel = {
  primary: NavigationItem[];
  work: NavigationItem[];
  personal: NavigationItem[];
  advanced: NavigationItem[];
};

/**
 * Single visibility predicate. `employmentType` is never consulted.
 *
 * During staff-backfill compatibility mode, already-shipped surfaces stay
 * visible so enabling the registry cannot take away anything a user reaches
 * today; new modules are `planned` and hidden regardless.
 */
export function canViewModule(
  ctx: AccessContext,
  module: ModuleDefinition,
): boolean {
  if (!isModuleRoutable(module)) return false;
  if (module.requiredPermissions.length === 0) return true;

  const resolved = withLegacyCompatibilityGrants(ctx);
  const permitted =
    module.permissionMode === "all"
      ? hasAllPermissions(resolved, module.requiredPermissions)
      : hasAnyPermission(resolved, module.requiredPermissions);

  if (permitted) return true;
  return isStaffCompatibilityMode(ctx) && module.legacyFallbackVisible;
}

export function visibleModules(
  ctx: AccessContext,
  surface: NavigationSurface = "desktop",
): ModuleDefinition[] {
  return MODULE_REGISTRY.filter((module) => {
    if (surface === "mobile" && !module.mobileVisibility) return false;
    if (surface === "dashboard" && !module.dashboardVisibility) return false;
    if (surface === "desktop" && module.navigationGroup === "none") return false;
    return canViewModule(ctx, module);
  }).sort((a, b) => a.order - b.order);
}

function toItem(module: ModuleDefinition): NavigationItem {
  return {
    moduleId: module.id,
    label: module.label,
    href: module.primaryRoute,
    iconRef: module.iconRef,
    group: module.navigationGroup,
  };
}

export function buildNavigation(ctx: AccessContext): NavigationModel {
  const modules = visibleModules(ctx, "desktop");
  const pick = (group: NavigationGroup) =>
    modules.filter((m) => m.navigationGroup === group).map(toItem);

  return {
    primary: pick("primary"),
    work: pick("work"),
    personal: pick("personal"),
    advanced: pick("advanced"),
  };
}

export function buildMobileNavigation(ctx: AccessContext): NavigationItem[] {
  return visibleModules(ctx, "mobile").map(toItem);
}

export function buildDashboardShortcuts(ctx: AccessContext): NavigationItem[] {
  return visibleModules(ctx, "dashboard").map(toItem);
}
