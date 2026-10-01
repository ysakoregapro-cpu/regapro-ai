import { requireModuleAccess } from "@/lib/platform/guards";

export default async function ShiftLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireModuleAccess("shift");
  return children;
}
