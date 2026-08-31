import { AppShell } from "@/components/shell/AppShell";
import { isDevSampleMode } from "@/lib/supabase/env";
import { resolveShellNavigation } from "@/lib/platform/navigation";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let showDemoBadge = false;
  try {
    showDemoBadge = isDevSampleMode();
  } catch {
    showDemoBadge = false;
  }

  const navigation = await resolveShellNavigation();

  return (
    <AppShell showDemoBadge={showDemoBadge} navigation={navigation}>
      {children}
    </AppShell>
  );
}
