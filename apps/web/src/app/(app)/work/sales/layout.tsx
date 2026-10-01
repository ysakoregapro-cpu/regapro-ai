import { requireModuleAccess } from "@/lib/platform/guards";

export default async function SalesLayout({ children }: { children: React.ReactNode }) {
  await requireModuleAccess("sales");
  return children;
}
