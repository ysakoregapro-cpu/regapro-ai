import { EmptyState, PageHeader, ListRow } from "@/components/ui/primitives";
import { listProjects } from "@/lib/application/catalog-service";
import { isDevSampleMode } from "@/lib/supabase/env";

export const metadata = { title: "プロジェクト" };

export default function ProjectsPage() {
  const rows = listProjects();
  return (
    <div className="space-y-6">
      <PageHeader
        title="プロジェクト"
        description={
          isDevSampleMode()
            ? "進行中の案件一覧です"
            : "プロジェクト一覧の本番接続は段階的に拡張します。"
        }
      />
      {rows.length === 0 ? (
        <EmptyState
          title="表示できるプロジェクトはありません"
          description="supabase mode では確認用サンプルは表示しません。"
        />
      ) : (
        rows.map((p) => (
          <ListRow key={p.id} href={`/workspace/projects?id=${p.id}`}>
            <div>
              <p className="text-[14px] font-medium">{p.name}</p>
              <p className="text-[12px] text-text-secondary">{p.description}</p>
            </div>
          </ListRow>
        ))
      )}
    </div>
  );
}
