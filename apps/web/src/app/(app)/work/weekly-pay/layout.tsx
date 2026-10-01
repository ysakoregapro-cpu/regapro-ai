import { requireModuleAccess } from "@/lib/platform/guards";

export default async function WeeklyPayLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireModuleAccess("weekly_pay");
  return children;
}
