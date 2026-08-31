"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavigationItem } from "@regapro/platform";
import { cn } from "@/lib/cn";
import { DemoDataBadge } from "@/components/ui/primitives";
import { FALLBACK_NAV_ICON, NAV_ICONS } from "./nav-icons";

function isActive(pathname: string, href: string) {
  return pathname === href || (href !== "/home" && pathname.startsWith(href));
}

function NavLink({
  item,
  pathname,
  compact,
}: {
  item: NavigationItem;
  pathname: string;
  compact?: boolean;
}) {
  const Icon = NAV_ICONS[item.iconRef] ?? FALLBACK_NAV_ICON;
  const active = isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-3 text-[13px] transition-colors",
        compact ? "min-h-10" : "min-h-11",
        active
          ? "bg-accent-muted font-medium text-accent"
          : "text-text-secondary hover:bg-surface-raised hover:text-text"
      )}
      aria-current={active ? "page" : undefined}
    >
      <Icon className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
      {item.label}
    </Link>
  );
}

export function DesktopSidebar({
  showDemoBadge,
  primary,
  work,
  personal,
  advanced,
}: {
  showDemoBadge: boolean;
  primary: NavigationItem[];
  work: NavigationItem[];
  personal: NavigationItem[];
  advanced: NavigationItem[];
}) {
  const pathname = usePathname();
  const secondary = [...personal, ...advanced];

  return (
    <aside
      className="hidden h-dvh w-[240px] shrink-0 flex-col border-r border-border bg-surface md:flex"
      aria-label="メインナビゲーション"
    >
      <div className="flex h-12 items-center gap-2 border-b border-border px-4">
        <span
          className="min-w-0 flex-1 truncate text-[14px] font-semibold tracking-tight text-text"
          title="RegaloProfessional"
        >
          RegaloProfessional
        </span>
        {showDemoBadge ? (
          <span className="shrink-0">
            <DemoDataBadge />
          </span>
        ) : null}
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {primary.map((item) => (
          <NavLink key={item.moduleId} item={item} pathname={pathname} />
        ))}
        {work.length > 0 ? (
          <>
            <p className="px-3 pt-3 pb-1 text-[11px] font-medium text-text-muted">
              業務
            </p>
            {work.map((item) => (
              <NavLink key={item.moduleId} item={item} pathname={pathname} />
            ))}
          </>
        ) : null}
      </nav>
      {secondary.length > 0 ? (
        <div className="border-t border-border p-2">
          {secondary.map((item) => (
            <NavLink
              key={item.moduleId}
              item={item}
              pathname={pathname}
              compact
            />
          ))}
        </div>
      ) : null}
    </aside>
  );
}
