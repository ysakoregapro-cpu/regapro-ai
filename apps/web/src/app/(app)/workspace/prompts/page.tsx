import { EmptyState, PageHeader, ListRow } from "@/components/ui/primitives";
import { listPrompts, projectName } from "@/lib/application/catalog-service";
import { isDevSampleMode } from "@/lib/supabase/env";

export const metadata = { title: "プロンプト" };

export default function PromptsPage() {
  const rows = listPrompts();
  return (
    <div className="space-y-6">
      <PageHeader
        title="プロンプト"
        description={
          isDevSampleMode()
            ? "再利用する指示の一覧です"
            : "プロンプトライブラリの本番接続は今後拡張します。"
        }
      />
      {rows.length === 0 ? (
        <EmptyState
          title="表示できるプロンプトはありません"
          description="supabase mode では確認用サンプルは表示しません。"
        />
      ) : (
        rows.map((p) => (
          <ListRow key={p.id}>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-medium">{p.title}</p>
              <p className="text-[12px] text-text-secondary">
                {p.target} · {projectName(p.projectId)}
              </p>
            </div>
          </ListRow>
        ))
      )}
    </div>
  );
}
