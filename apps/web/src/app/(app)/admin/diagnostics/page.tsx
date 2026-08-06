import { PageHeader, ConnectionStatus, StatusBadge } from "@/components/ui/primitives";

export const metadata = { title: "診断情報" };

export default function DiagnosticsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="診断情報"
        description="管理者向け。一般画面には表示されない内部状態です"
      />
      <section className="space-y-1">
        <h2 className="text-[14px] font-semibold">接続状態</h2>
        <ConnectionStatus
          label="データモード"
          connected
          reason="dev-sample（確認用）"
        />
        <ConnectionStatus
          label="SearXNG"
          connected={false}
          reason="未設定のため標準検索経路はローカル検証のみ"
        />
        <ConnectionStatus
          label="Tavily（補助）"
          connected={false}
          reason="APIキー未設定・実呼び出し無効"
        />
        <ConnectionStatus
          label="Firecrawl（補助）"
          connected={false}
          reason="インターフェースのみ。プラグイン・実API呼び出しなし"
        />
        <ConnectionStatus
          label="Exa"
          connected={false}
          reason="交換可能なProvider。標準経路外"
        />
        <ConnectionStatus
          label="Google Workspace"
          connected={false}
          reason="認証情報がないため未接続"
        />
        <ConnectionStatus
          label="ブラウザ内モデル"
          connected={false}
          reason="初回ダウンロード未実施（アプリ本体は利用可能）"
        />
        <ConnectionStatus
          label="プッシュ通知"
          connected={false}
          reason="配信基盤未接続。通知予定は保存可能"
        />
      </section>
      <section>
        <h2 className="mb-2 text-[14px] font-semibold">ジョブ・通知</h2>
        <ul className="space-y-2 text-[13px]">
          <li className="flex justify-between border-b border-border py-2">
            <span>調査ジョブ</span>
            <StatusBadge>待機 0 / 失敗 0</StatusBadge>
          </li>
          <li className="flex justify-between border-b border-border py-2">
            <span>成果物ジョブ</span>
            <StatusBadge>待機 0 / 失敗 0</StatusBadge>
          </li>
          <li className="flex justify-between border-b border-border py-2">
            <span>通知配信</span>
            <StatusBadge tone="warning">予定保存のみ</StatusBadge>
          </li>
        </ul>
      </section>
    </div>
  );
}
