import { AppShell } from "@/components/shell/AppShell";
import { isDevSampleMode } from "@/lib/supabase/env";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  let showDemoBadge = false;
  try {
    showDemoBadge = isDevSampleMode();
  } catch {
    showDemoBadge = false;
  }

  return <AppShell showDemoBadge={showDemoBadge}>{children}</AppShell>;
}
