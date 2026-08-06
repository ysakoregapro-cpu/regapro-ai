import { WorkspaceSubnav } from "@/components/workspace/WorkspaceSubnav";
import { ListRow, PageHeader, StatusBadge } from "@/components/ui/primitives";
import { listKnowledge, projectName } from "@/lib/application/catalog-service";

export const metadata = { title: "ナレッジ" };

const statusLabel: Record<string, string> = {
  published: "公開",
  approved: "承認済",
  review: "確認中",
  draft: "下書き",
};

export default function KnowledgePage() {
  const items = listKnowledge();
  return (
    <div>
      <WorkspaceSubnav />
      <PageHeader
        title="ナレッジ"
        description="承認を経た社内ナレッジを検索・参照します"
      />
      <div className="mt-4">
        {items.map((k) => (
          <ListRow key={k.id}>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-medium">{k.title}</p>
              <p className="mt-0.5 text-[12px] text-text-secondary">
                {k.category} · {k.business} · {projectName(k.projectId)}
              </p>
            </div>
            <div className="hidden flex-col items-end gap-1 sm:flex">
              <StatusBadge tone={k.approvalStatus === "published" ? "success" : "neutral"}>
                {statusLabel[k.approvalStatus] ?? k.approvalStatus}
              </StatusBadge>
              <span className="text-[11px] text-text-muted">
                {k.freshness} · {k.updatedAt}
              </span>
            </div>
          </ListRow>
        ))}
      </div>
    </div>
  );
}
