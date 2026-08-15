import { PageHeader } from "@/components/ui/primitives";
import { resolveAppSession } from "@/lib/application/session-access";
import { isDevSampleMode } from "@/lib/supabase/env";
import { CONFIDENTIALITY_LABELS } from "@regapro/shared";

export const metadata = { title: "設定" };

export default async function SettingsPage() {
  const session = await resolveAppSession();
  const sample = isDevSampleMode();

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <PageHeader
        title="設定"
        description={
          sample
            ? "確認用の所属情報です"
            : "組織メンバーシップに基づくプロフィールです"
        }
      />
      <dl className="divide-y divide-border border-y border-border">
        <div className="flex justify-between gap-4 py-3 text-[14px]">
          <dt className="text-text-secondary">氏名</dt>
          <dd>{session.membership.name}</dd>
        </div>
        <div className="flex justify-between gap-4 py-3 text-[14px]">
          <dt className="text-text-secondary">部署</dt>
          <dd>{session.membership.departmentLabel}</dd>
        </div>
        <div className="flex justify-between gap-4 py-3 text-[14px]">
          <dt className="text-text-secondary">メール</dt>
          <dd>{session.membership.email}</dd>
        </div>
        <div className="flex justify-between gap-4 py-3 text-[14px]">
          <dt className="text-text-secondary">役割</dt>
          <dd>{session.membership.role}</dd>
        </div>
        <div className="flex justify-between gap-4 py-3 text-[14px]">
          <dt className="text-text-secondary">扱える情報区分</dt>
          <dd>
            {CONFIDENTIALITY_LABELS[session.maximumConfidentialityLevel]}
          </dd>
        </div>
      </dl>
    </div>
  );
}
