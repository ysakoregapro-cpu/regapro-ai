import { WorkspaceSubnav } from "@/components/workspace/WorkspaceSubnav";
import { ListRow, PageHeader, StatusBadge } from "@/components/ui/primitives";
import { listDocuments, projectName } from "@/lib/application/catalog-service";

export const metadata = { title: "ドキュメント" };

export default function DocumentsPage() {
  const items = listDocuments();
  return (
    <div>
      <WorkspaceSubnav />
      <PageHeader title="ドキュメント" description="会話から分離した資料・コード・成果物" />
      <div className="mt-4">
        {items.map((d) => (
          <ListRow key={d.id}>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-medium">{d.title}</p>
              <p className="mt-0.5 text-[12px] text-text-secondary">
                {projectName(d.projectId)} · {d.updatedAt}
              </p>
            </div>
            <StatusBadge>{d.kind}</StatusBadge>
          </ListRow>
        ))}
      </div>
    </div>
  );
}
