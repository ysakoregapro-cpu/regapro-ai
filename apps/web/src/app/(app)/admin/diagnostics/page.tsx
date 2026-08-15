import { PageHeader, ConnectionStatus, StatusBadge } from "@/components/ui/primitives";
import { getDataMode, isDevSampleMode } from "@/lib/supabase/env";

export const metadata = { title: "診断情報" };

export default function DiagnosticsPage() {
  const mode = getDataMode();
  const sample = isDevSampleMode();
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
          connected={!sample}
          reason={
            sample
              ? "dev-sample（確認用メモリ）"
              : `supabase（REGAPRO_DATA_MODE=${mode}）`
          }
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
          label="成果物本文"
          connected={!sample}
          reason={
            sample
              ? "確認用メモリ"
              : "artifact_versions.canonical_content（DB・永続）。PDF等の export は Storage（未実装）"
          }
        />
        <ConnectionStatus
          label="ファイル本体 Storage"
          connected={!sample}
          reason={
            sample
              ? "確認用・再起動で失われる場合あり"
              : "chat-attachments bucket + file_objects（認証済み JWT / RLS）"
          }
        />
      </section>
      <section className="space-y-2">
        <h2 className="text-[14px] font-semibold">注意</h2>
        <p className="text-[13px] text-text-secondary">
          Research は確認用フローが含まれる場合があります。実検索済みと誤解しないでください。
          成果物本文とチャット添付ファイルは durable 保存されます（Office 出力形式の生成は未接続）。
        </p>
        <StatusBadge tone="neutral">業務 OS 向け診断</StatusBadge>
      </section>
    </div>
  );
}
