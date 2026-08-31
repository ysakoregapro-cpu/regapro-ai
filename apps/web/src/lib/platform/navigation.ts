import "server-only";
import { unstable_rethrow } from "next/navigation";
import {
  buildDashboardShortcuts,
  buildMobileNavigation,
  buildNavigation,
  type NavigationItem,
} from "@regapro/platform";
import { NAV_MOBILE, NAV_PRIMARY } from "@/lib/navigation";
import { resolvePlatformSession } from "./access";

/**
 * Security layer 1 — what the shell shows.
 *
 * Uses the same registry and permission engine as the route and API guards, so
 * a module can never be visible-but-blocked or hidden-but-reachable.
 */

export type ShellNavigation = {
  primary: NavigationItem[];
  work: NavigationItem[];
  personal: NavigationItem[];
  advanced: NavigationItem[];
  mobile: NavigationItem[];
  dashboard: NavigationItem[];
};

function toItems(items: readonly { href: string; label: string; id: string }[]) {
  return items.map((item) => ({
    moduleId: "home" as const,
    label: item.label,
    href: item.href,
    iconRef: item.id,
    group: "primary" as const,
  }));
}

/**
 * Used when no session can be resolved. Mirrors what an authenticated user sees
 * today, so a resolution failure degrades to the current shell rather than an
 * empty one.
 */
function fallbackNavigation(): ShellNavigation {
  return {
    primary: toItems(NAV_PRIMARY),
    work: [],
    personal: [],
    advanced: [],
    mobile: toItems(NAV_MOBILE),
    dashboard: [],
  };
}

export async function resolveShellNavigation(): Promise<ShellNavigation> {
  try {
    const { access } = await resolvePlatformSession();
    const nav = buildNavigation(access);
    return {
      ...nav,
      mobile: buildMobileNavigation(access),
      dashboard: buildDashboardShortcuts(access),
    };
  } catch (err) {
    // Next.js signals dynamic rendering and redirects by throwing; swallowing
    // those would prerender the shell with the wrong navigation.
    unstable_rethrow(err);
    return fallbackNavigation();
  }
}
