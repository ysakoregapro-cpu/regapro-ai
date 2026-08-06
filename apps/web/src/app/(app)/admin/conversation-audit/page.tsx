import { PageHeader, ListRow, EmptyState } from "@/components/ui/primitives";
import { resolveSessionAccess } from "@/lib/data/dev-sample/memberships";
import { listVisibleThreads } from "@/lib/application/chat-service";

export const metadata = { title: "会話監査" };

export default function ConversationAuditPage() {
  const session = resolveSessionAccess({
    userId: "user-auditor",
    auditMode: true,
    auditCaseId: "audit-demo-1",
  });
  const allowed = session.permissions.includes("conversation:audit");

  // Demo: show that even auditor must open a case — list notes only
  const ownThreads = listVisibleThreads("user-auditor");

  return (
    <div className="space-y-4">
      <PageHeader
        title="会話監査"
        description="通常の検索・アシスタントから分離された監査専用画面です"
      />
      {!allowed ? (
        <EmptyState
          title="権限がありません"
          description="会話監査権限は経営戦略権限とは別に付与されます"
        />
      ) : (
        <>
          <p className="text-[13px] text-text-secondary">
            監査を開始するには、理由・対象ユーザー・期間またはスレッドを記録します。Level
            3 の閲覧権限だけでは他社員の個人会話は読めません。
          </p>
          <form className="space-y-2 border-b border-border pb-4">
            <label className="block text-[12px] text-text-secondary">
              監査理由
              <input
                className="mt-1 h-9 w-full rounded-md border border-border bg-surface px-2 text-[13px]"
                placeholder="例）内部通報に基づく期間限定確認"
              />
            </label>
            <label className="block text-[12px] text-text-secondary">
              対象ユーザー
              <input
                className="mt-1 h-9 w-full rounded-md border border-border bg-surface px-2 text-[13px]"
                placeholder="氏名またはメール"
              />
            </label>
            <button
              type="button"
              className="h-9 rounded-md bg-accent px-3 text-[13px] text-accent-fg"
            >
              監査ケースを開く
            </button>
          </form>
          <section>
            <h2 className="mb-2 text-[14px] font-semibold">自分の会話（通常閲覧）</h2>
            {ownThreads.length === 0 ? (
              <p className="text-[13px] text-text-secondary">表示できる会話はありません</p>
            ) : (
              ownThreads.map((t) => (
                <ListRow key={t.id}>
                  <p className="text-[13px]">{t.title}</p>
                </ListRow>
              ))
            )}
          </section>
        </>
      )}
    </div>
  );
}
