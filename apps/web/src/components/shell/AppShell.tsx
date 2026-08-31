"use client";

import { useEffect, useState } from "react";
import type { NavigationItem } from "@regapro/platform";
import { DesktopSidebar } from "./DesktopSidebar";
import { MobileBottomNavigation } from "./MobileBottomNavigation";
import { CommandPalette, TopBar } from "./TopBar";

export type ShellNavigationProps = {
  primary: NavigationItem[];
  work: NavigationItem[];
  personal: NavigationItem[];
  advanced: NavigationItem[];
  mobile: NavigationItem[];
};

export function AppShell({
  children,
  showDemoBadge,
  title,
  navigation,
}: {
  children: React.ReactNode;
  showDemoBadge: boolean;
  title?: string;
  navigation: ShellNavigationProps;
}) {
  const [commandOpen, setCommandOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-dvh overflow-hidden bg-bg text-text">
      <DesktopSidebar
        showDemoBadge={showDemoBadge}
        primary={navigation.primary}
        work={navigation.work}
        personal={navigation.personal}
        advanced={navigation.advanced}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={title} onOpenCommand={() => setCommandOpen(true)} />
        <main
          className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-5"
          style={{
            paddingBottom:
              "calc(var(--mobile-nav-height) + env(safe-area-inset-bottom) + 16px)",
          }}
        >
          <div className="mx-auto w-full max-w-[1120px]">{children}</div>
        </main>
        <MobileBottomNavigation items={navigation.mobile} />
      </div>
      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} />
    </div>
  );
}
