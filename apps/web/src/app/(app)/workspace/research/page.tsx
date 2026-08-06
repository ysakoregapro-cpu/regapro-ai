import { WorkspaceSubnav } from "@/components/workspace/WorkspaceSubnav";
import { ListRow, PageHeader, StatusBadge } from "@/components/ui/primitives";
import { listResearch, projectName } from "@/lib/application/catalog-service";

export const metadata = { title: "調査" };

export default function ResearchPage() {
  const items = listResearch();
  return (
    <div>
      <WorkspaceSubnav />
      <PageHeader title="調査" description="Webの情報を横断し、出典付きで整理します" />
      <div className="mt-4">
        {items.map((r) => (
          <ListRow key={r.id}>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-medium">{r.title}</p>
              <p className="mt-0.5 text-[12px] text-text-secondary">
                {projectName(r.projectId)} · {r.updatedAt}
              </p>
            </div>
            <StatusBadge tone="accent">{r.statusLabel}</StatusBadge>
          </ListRow>
        ))}
      </div>
      <p className="mt-6 text-[12px] text-text-secondary">
        外部有料検索の補助経路は未接続です。標準の調査経路のみ利用できます。
      </p>
    </div>
  );
}
