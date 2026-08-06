"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, MessageSquare, CheckSquare, Search } from "lucide-react";
import { NAV_MOBILE } from "@/lib/navigation";
import { cn } from "@/lib/cn";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  home: Home,
  assistant: MessageSquare,
  tasks: CheckSquare,
  search: Search,
};

export function MobileBottomNavigation() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-[20] border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label="モバイルナビゲーション"
      style={{ height: "calc(var(--mobile-nav-height) + env(safe-area-inset-bottom))" }}
    >
      <ul className="grid h-[56px] grid-cols-4">
        {NAV_MOBILE.map((item) => {
          const Icon = ICONS[item.id] ?? Home;
          const active =
            pathname === item.href ||
            (item.href !== "/home" && pathname.startsWith(item.href));
          return (
            <li key={item.id}>
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
