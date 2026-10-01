import { requireModuleAccess } from "@/lib/platform/guards";

export default async function WorkRecordsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireModuleAccess("work_record");
  return children;
}
