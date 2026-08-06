"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WORKSPACE_NAV } from "@/lib/navigation";

export function WorkspaceSubnav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="ワークスペース"
      className="mb-4 flex gap-1 overflow-x-auto border-b border-border pb-2"
    >
      {WORKSPACE_NAV.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] ${
              active
                ? "bg-accent-muted font-medium text-accent"
                : "text-text-secondary hover:bg-surface-raised"
            }`}
            aria-current={active ? "page" : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
