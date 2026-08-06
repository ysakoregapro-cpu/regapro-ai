import { WorkspaceSubnav } from "@/components/workspace/WorkspaceSubnav";
import { ListRow, PageHeader, StatusBadge } from "@/components/ui/primitives";
import { listPrompts, projectName } from "@/lib/application/catalog-service";

export const metadata = { title: "プロンプト" };

export default function PromptsPage() {
  const items = listPrompts();
  return (
    <div>
      <WorkspaceSubnav />
      <PageHeader
        title="プロンプト"
        description="Cursor や外部AI向けの指示書を作成・再利用します"
      />
      <div className="mt-4">
        {items.map((p) => (
          <ListRow key={p.id}>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-medium">{p.title}</p>
              <p className="mt-0.5 text-[12px] text-text-secondary">
                {projectName(p.projectId)} · {p.updatedAt}
              </p>
            </div>
            <StatusBadge tone="accent">{p.target}</StatusBadge>
          </ListRow>
        ))}
      </div>
    </div>
  );
}
