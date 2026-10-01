import { requireModuleAccess } from "@/lib/platform/guards";

export default async function ExpenseLayout({ children }: { children: React.ReactNode }) {
  await requireModuleAccess("expense");
  return children;
}
