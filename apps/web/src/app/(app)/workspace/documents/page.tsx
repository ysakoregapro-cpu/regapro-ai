import { EmptyState, PageHeader, ListRow } from "@/components/ui/primitives";
import { listDocuments, projectName } from "@/lib/application/catalog-service";
import { listDocumentLibraryAsync } from "@/lib/application/data-gateway";
import { isDevSampleMode } from "@/lib/supabase/env";

export const metadata = { title: "ドキュメント" };

export default async function DocumentsPage() {
  const docs = isDevSampleMode()
    ? listDocuments().map((d) => ({
        id: d.id,
        title: d.title,
        kind: d.kind,
        projectLabel: projectName(d.projectId),
        note: null as string | null,
      }))
    : (await listDocumentLibraryAsync()).map((a) => ({
        id: a.id,
        title: a.title,
        kind: a.format,
        projectLabel: a.projectId ? "プロジェクト" : "—",
        note:
          a.markdownPreview
            ? null
            : "本文がまだありません",
      }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="ドキュメント"
        description={
          isDevSampleMode()
            ? "作成した資料・文面の一覧です"
            : "成果物メタデータと本文（artifact_versions.canonical_content）です"
        }
      />
      {docs.length === 0 ? (
        <EmptyState
          title="ドキュメントはまだありません"
          description="資料作成ワークフローから成果物を作成できます。"
        />
      ) : (
        docs.map((d) => (
          <ListRow key={d.id} href={d.id ? `/assistant` : undefined}>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-medium">{d.title}</p>
              <p className="text-[12px] text-text-secondary">
                {d.kind} · {d.projectLabel}
              </p>
              {d.note ? (
                <p className="mt-1 text-[11px] text-text-muted">{d.note}</p>
              ) : null}
            </div>
          </ListRow>
        ))
      )}
    </div>
  );
}
