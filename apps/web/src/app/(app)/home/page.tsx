import Link from "next/link";
import { PageHeader, SectionHeader, ListRow, StatusBadge } from "@/components/ui/primitives";
import { HomeAskComposer } from "@/components/chat/HomeAskComposer";
import { HomeToolGrid } from "@/components/chat/WorkflowActions";
import { getHomeDashboard, projectName, userName } from "@/lib/application/catalog-service";
import { resolveSessionAccess } from "@/lib/data/dev-sample/memberships";

export const metadata = { title: "ホーム" };

export default function HomePage() {
  const data = getHomeDashboard();
  const session = resolveSessionAccess();
  const locked = session.selectableLevels.length <= 1;

  return (
    <div className="space-y-8">
      <PageHeader
        title={`${data.greetingName.split(" ")[0]}さん、今日も進めましょう`}
        description="何を進めますか？"
        actions={
          <Link
            href="/assistant"
            className="inline-flex h-9 items-center rounded-md bg-accent px-3 text-[13px] font-medium text-accent-fg hover:bg-accent-hover"
          >
            新しく依頼する
          </Link>
        }
      />

      <HomeAskComposer
        selectableLevels={session.selectableLevels}
        defaultLevel="company"
        locked={locked}
      />

      <section>
        <SectionHeader title="よく使う作業" />
        <HomeToolGrid />
      </section>

      <section>
        <SectionHeader title="今日のタスク" />
        <div>
          {data.todayTasks.map((t) => (
            <ListRow key={t.id} href={`/tasks?task=${t.id}`}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium">{t.title}</p>
                <p className="mt-0.5 text-[12px] text-text-secondary">
                  {userName(t.assigneeId)} · {projectName(t.projectId)}
                </p>
              </div>
              <StatusBadge tone={t.priority === "urgent" ? "danger" : "neutral"}>
                {t.dueAt.slice(5, 16).replace("T", " ")}
              </StatusBadge>
            </ListRow>
          ))}
        </div>
      </section>

      <section>
        <SectionHeader title="期限が近いタスク" />
        {data.dueSoonTasks.length === 0 ? (
          <p className="py-3 text-[13px] text-text-secondary">近日中の期限はありません</p>
        ) : (
          data.dueSoonTasks.map((t) => (
            <ListRow key={t.id} href={`/tasks?task=${t.id}`}>
              <p className="flex-1 truncate text-[14px]">{t.title}</p>
              <span className="text-[12px] text-text-secondary">{t.dueAt.slice(0, 10)}</span>
            </ListRow>
          ))
        )}
      </section>

      <section>
        <SectionHeader title="対応が必要な項目" />
        {data.needsAttention.map((item) => (
          <ListRow key={item.id} href="/tasks?filter=today">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px]">{item.title}</p>
              <p className="text-[12px] text-text-secondary">{item.reason}</p>
            </div>
          </ListRow>
        ))}
      </section>

      <section>
        <SectionHeader title="作業を続ける" />
        {data.continueWork.map((item) => (
          <ListRow key={item.id} href={item.href}>
            <p className="text-[14px]">{item.title}</p>
          </ListRow>
        ))}
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <SectionHeader title="最近のチャット" />
          {data.recentThreads.map((th) => (
            <ListRow key={th.id} href={`/assistant?thread=${th.id}`}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px]">{th.title}</p>
                <p className="truncate text-[12px] text-text-secondary">{th.preview}</p>
              </div>
            </ListRow>
          ))}
        </section>
        <section>
          <SectionHeader title="最近作成したドキュメント" />
          {data.recentDocuments.map((d) => (
            <ListRow key={d.id} href="/workspace/documents">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px]">{d.title}</p>
                <p className="text-[12px] text-text-secondary">{d.kind}</p>
              </div>
            </ListRow>
          ))}
        </section>
      </div>

      <section>
        <SectionHeader title="よく使うプロジェクト" />
        <div className="divide-y divide-border">
          {data.frequentProjects.map((p) => (
            <ListRow key={p.id} href={`/workspace/projects?id=${p.id}`}>
              <div>
                <p className="text-[14px] font-medium">{p.name}</p>
                <p className="text-[12px] text-text-secondary">{p.description}</p>
              </div>
            </ListRow>
          ))}
        </div>
      </section>

      <section>
        <SectionHeader title="最近の動き" />
        {data.recentActivity.map((a) => (
          <ListRow key={a.id}>
            <p className="flex-1 text-[13px]">{a.label}</p>
            <span className="text-[12px] text-text-muted">
              {a.at.slice(5, 16).replace("T", " ")}
            </span>
          </ListRow>
        ))}
      </section>
    </div>
  );
}
