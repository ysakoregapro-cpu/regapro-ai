"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  MessageSquare,
  CheckSquare,
  Search,
  LayoutGrid,
  Settings,
  Shield,
} from "lucide-react";
import { NAV_PRIMARY } from "@/lib/navigation";
import { cn } from "@/lib/cn";
import { DemoDataBadge } from "@/components/ui/primitives";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  home: Home,
  assistant: MessageSquare,
  tasks: CheckSquare,
  search: Search,
  workspace: LayoutGrid,
};

export function DesktopSidebar({ showDemoBadge }: { showDemoBadge: boolean }) {
  const pathname = usePathname();

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
      <nav className="flex flex-1 flex-col gap-0.5 p-2">
        {NAV_PRIMARY.map((item) => {
          const Icon = ICONS[item.id] ?? Home;
          const active =
            pathname === item.href ||
            (item.href !== "/home" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.id}
              href={item.href}
              className={cn(
                "flex min-h-11 items-center gap-2.5 rounded-md px-3 text-[13px] transition-colors",
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
        })}
      </nav>
      <div className="border-t border-border p-2">
        <Link
          href="/settings"
          className="flex min-h-10 items-center gap-2.5 rounded-md px-3 text-[13px] text-text-secondary hover:bg-surface-raised hover:text-text"
        >
          <Settings className="h-4 w-4" aria-hidden />
          設定
        </Link>
        <Link
          href="/admin"
          className="flex min-h-10 items-center gap-2.5 rounded-md px-3 text-[13px] text-text-secondary hover:bg-surface-raised hover:text-text"
        >
          <Shield className="h-4 w-4" aria-hidden />
          管理センター
        </Link>
      </div>
    </aside>
  );
}
