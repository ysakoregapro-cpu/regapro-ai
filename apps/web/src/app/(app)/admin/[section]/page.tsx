import { PageHeader } from "@/components/ui/primitives";
import { ADMIN_NAV } from "@/lib/navigation";

type Props = { params: Promise<{ section: string }> };

const TITLES: Record<string, string> = Object.fromEntries(
  ADMIN_NAV.map((n) => [n.href.replace("/admin/", ""), n.label])
);

export default async function AdminSectionPage({ params }: Props) {
  const { section } = await params;
  const title = TITLES[section] ?? "管理";

  return (
    <div className="space-y-4">
      <PageHeader title={title} description="管理センターの各機能画面です" />
      <p className="text-[13px] text-text-secondary">
        このセクションの詳細操作は、権限とデータモードに応じて Application Service
        経由で提供されます。サンプルモードでは参照用の骨格を表示しています。
      </p>
      {section === "connections" ? (
        <ul className="text-[13px]">
          <li className="border-b border-border py-2">Google Docs — 未接続</li>
          <li className="border-b border-border py-2">Google Sheets — 未接続</li>
          <li className="border-b border-border py-2">Google Drive — 未接続</li>
          <li className="border-b border-border py-2">プッシュ通知 — 未接続</li>
        </ul>
      ) : null}
    </div>
  );
}
