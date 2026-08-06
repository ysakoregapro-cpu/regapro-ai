import { PageHeader, ListRow, PermissionGate } from "@/components/ui/primitives";
import { ADMIN_NAV } from "@/lib/navigation";

export const metadata = { title: "管理センター" };

export default function AdminPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="管理センター" description="組織・権限・接続・監査を管理します" />
      <PermissionGate allowed>
        <div>
          {ADMIN_NAV.map((item) => (
            <ListRow key={item.href} href={item.href}>
              <p className="text-[14px]">{item.label}</p>
            </ListRow>
          ))}
        </div>
      </PermissionGate>
    </div>
  );
}
