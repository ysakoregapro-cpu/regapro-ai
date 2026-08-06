import { WorkspaceSubnav } from "@/components/workspace/WorkspaceSubnav";
import { ListRow, PageHeader } from "@/components/ui/primitives";
import { listProjects } from "@/lib/application/catalog-service";

export const metadata = { title: "プロジェクト" };

export default function ProjectsPage() {
  const items = listProjects();
  return (
    <div>
      <WorkspaceSubnav />
      <PageHeader title="プロジェクト" description="案件・事業単位で情報と作業をまとめます" />
      <div className="mt-4">
        {items.map((p) => (
          <ListRow key={p.id}>
            <div>
              <p className="text-[14px] font-medium">{p.name}</p>
              <p className="mt-0.5 text-[12px] text-text-secondary">{p.description}</p>
            </div>
          </ListRow>
        ))}
      </div>
    </div>
  );
}
