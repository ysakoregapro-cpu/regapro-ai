import { PageHeader, EmptyState } from "@/components/ui/primitives";
import { resolveAppSession } from "@/lib/application/session-access";
import { isDevSampleMode } from "@/lib/supabase/env";

export const metadata = { title: "会話監査" };

export default async function ConversationAuditPage() {
  if (isDevSampleMode()) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="会話監査"
          description="監査は専用権限と監査ケース経路でのみ実施します"
        />
        <EmptyState
          title="確認用モードでは監査 UI を開いていません"
          description="supabase mode で conversation:audit 権限と監査ケースを用いて検証してください。"
        />
      </div>
    );
  }

  const session = await resolveAppSession();
  const canAudit = session.permissions.includes("conversation:audit");

  return (
    <div className="space-y-6">
      <PageHeader
        title="会話監査"
        description="通常の会話 SELECT とは分離された監査経路です"
      />
      {!canAudit ? (
        <EmptyState
          title="監査権限がありません"
          description="conversation:audit が付与されたメンバーのみが監査ケースにアクセスできます。他人の private 会話は通常一覧に出ません。"
        />
      ) : (
        <EmptyState
          title="監査ケースは別テーブルです"
          description="通常のチャット一覧では private 会話を閲覧できません。監査操作は conversation_audit_cases 経由で実施してください。"
        />
      )}
    </div>
  );
}
