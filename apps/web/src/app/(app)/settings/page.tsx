import { PageHeader, ConnectionStatus } from "@/components/ui/primitives";
import { CURRENT_USER } from "@/lib/data/dev-sample/catalog";

export const metadata = { title: "設定" };

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="設定" />
      <section>
        <h2 className="mb-2 text-[16px] font-semibold">プロフィール</h2>
        <dl className="space-y-2 text-[13px]">
          <div className="flex justify-between border-b border-border py-2">
            <dt className="text-text-secondary">氏名</dt>
            <dd>{CURRENT_USER.name}</dd>
          </div>
          <div className="flex justify-between border-b border-border py-2">
            <dt className="text-text-secondary">部署</dt>
            <dd>{CURRENT_USER.department}</dd>
          </div>
          <div className="flex justify-between border-b border-border py-2">
            <dt className="text-text-secondary">メール</dt>
            <dd>{CURRENT_USER.email}</dd>
          </div>
        </dl>
      </section>
      <section>
        <h2 className="mb-2 text-[16px] font-semibold">タスク</h2>
        <label className="flex items-start gap-2 text-[13px]">
          <input type="checkbox" className="mt-1" disabled />
          <span>
            高確信度のタスクを確認なしで自動登録する
            <span className="mt-0.5 block text-[12px] text-text-secondary">
              初期値はオフです。明示的に有効化した場合のみ動作します。
            </span>
          </span>
        </label>
      </section>
      <section>
        <h2 className="mb-2 text-[16px] font-semibold">通知</h2>
        <p className="text-[13px] text-text-secondary">
          期限前日 09:00（Asia/Tokyo）。Push非対応時はアプリ内通知。
        </p>
      </section>
      <section>
        <h2 className="mb-2 text-[16px] font-semibold">外観</h2>
        <p className="text-[13px] text-text-secondary">
          ライトを初期値とし、システム設定に応じてダークにも対応します。
        </p>
      </section>
      <section>
        <h2 className="mb-2 text-[16px] font-semibold">接続</h2>
        <ConnectionStatus label="Google Workspace" connected={false} reason="認証情報未設定" />
      </section>
    </div>
  );
}
