"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavigationItem } from "@regapro/platform";
import { cn } from "@/lib/cn";
import { FALLBACK_NAV_ICON, NAV_ICONS } from "./nav-icons";

/**
 * Mobile is its own work context, not a stacked desktop sidebar: only modules
 * flagged `mobileVisibility` in the registry appear, capped so touch targets
 * stay comfortable.
 */
const MAX_MOBILE_ITEMS = 5;

export function MobileBottomNavigation({ items }: { items: NavigationItem[] }) {
  const pathname = usePathname();
  const visible = items.slice(0, MAX_MOBILE_ITEMS);

  if (visible.length === 0) return null;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-[20] border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label="モバイルナビゲーション"
      style={{ height: "calc(var(--mobile-nav-height) + env(safe-area-inset-bottom))" }}
    >
      <ul
        className="grid h-[56px]"
        style={{
          gridTemplateColumns: `repeat(${visible.length}, minmax(0, 1fr))`,
        }}
      >
        {visible.map((item) => {
          const Icon = NAV_ICONS[item.iconRef] ?? FALLBACK_NAV_ICON;
          const active =
            pathname === item.href ||
            (item.href !== "/home" && pathname.startsWith(item.href));
          return (
            <li key={item.moduleId}>
              <Link
                href={item.href}
                className={cn(
                  "flex h-full min-h-11 flex-col items-center justify-center gap-0.5 text-[11px]",
                  active ? "text-accent" : "text-text-secondary"
                )}
                aria-current={active ? "page" : undefined}
              >
                <Icon className="h-5 w-5" aria-hidden />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
