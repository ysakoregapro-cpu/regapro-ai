import { PageHeader, ConnectionStatus, StatusBadge } from "@/components/ui/primitives";
import { getProcessUsageSnapshot, listAnswerDiagnostics } from "@regapro/ai-runtime";
import { getDataMode, isDevSampleMode } from "@/lib/supabase/env";
import { cloudRuntimeStatus } from "@/lib/application/ai-runtime-factory";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { resolveAppSession } from "@/lib/application/session-access";
import { factoryCounts } from "@/lib/application/knowledge-factory-service";

export const metadata = { title: "診断情報" };
export const dynamic = "force-dynamic";

export default async function DiagnosticsPage() {
  const mode = getDataMode();
  const sample = isDevSampleMode();
  const runtime = cloudRuntimeStatus();
  const usage = getProcessUsageSnapshot();
  const diagnostics = listAnswerDiagnostics();
  let factory: Awaited<ReturnType<typeof factoryCounts>> | null = null;
  if (!sample) {
    try {
      const session = await resolveAppSession({});
      const client = await createServerSupabaseClient();
      factory = await factoryCounts(client, session.access.organizationId);
    } catch {
      factory = null;
    }
  }
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
          label="クラウド推論"
          connected={runtime.aiGateway}
          reason={
            runtime.aiGateway
              ? "推論ゲートウェイ接続済み（本体は RegaloProfessional Runtime）"
              : "未設定。Local が無くてもキー設定後に同一機能を利用できます"
          }
        />
        <ConnectionStatus
          label="Web検索"
          connected={runtime.tavily}
          reason={runtime.tavily ? "接続済み" : "未接続。結果の捏造はしません"}
        />
        <ConnectionStatus
          label="ページ取得"
          connected={runtime.firecrawl}
          reason={runtime.firecrawl ? "接続済み" : "未接続。検索スニペットのみ"}
        />
        <ConnectionStatus
          label="ブラウザ実行（高コスト）"
          connected={runtime.browserbase}
          reason={
            runtime.browserbase
              ? "接続済み（通常取得では使いません）"
              : "未接続"
          }
        />
        <ConnectionStatus
          label="補助検索スロット"
          connected={runtime.exa}
          reason={runtime.exa ? "接続済み" : "インターフェースのみ。偽結果なし"}
        />
        <ConnectionStatus
          label="観測"
          connected={runtime.langfuse}
          reason={
            runtime.langfuse
              ? "接続済み（L2/L3 は metadata のみ）"
              : "未接続"
          }
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
              : "chat-attachments / knowledge-sources + file_objects（認証済み JWT / RLS）"
          }
        />
      </section>
      <section className="space-y-1">
        <h2 className="text-[14px] font-semibold">利用状況（プロセス）</h2>
        <p className="text-[13px] text-text-secondary">
          LLM 呼び出し {usage.llmCalls} 回 / 推定トークン {usage.tokens} /
          失敗 {usage.failures} 回。料金そのものは一般画面に出しません。
        </p>
      </section>
      {factory ? (
        <section className="space-y-1">
          <h2 className="text-[14px] font-semibold">ナレッジ生産（件数のみ）</h2>
          <p className="text-[13px] text-text-secondary">
            Source {factory.sources} / Job {factory.jobs} / 候補 {factory.candidates} /
            承認 {factory.approved} / 公開 {factory.published} / チャンク {factory.chunks} /
            埋め込み {factory.embeddings} / 重複 {factory.duplicates} / 矛盾 {factory.conflicts} /
            失敗Job {factory.failedJobs}
          </p>
        </section>
      ) : null}
      <section className="space-y-2">
        <h2 className="text-[14px] font-semibold">直近の回答経路（件数のみ）</h2>
        {diagnostics.length === 0 ? (
          <p className="text-[13px] text-text-secondary">
            このプロセスでまだ回答診断はありません。本文や機密は記録しません。
          </p>
        ) : (
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="border-b border-border text-text-secondary">
                <th className="py-1 font-medium">intent</th>
                <th className="py-1 font-medium">internal</th>
                <th className="py-1 font-medium">web</th>
                <th className="py-1 font-medium">context</th>
                <th className="py-1 font-medium">cite</th>
                <th className="py-1 font-medium">persist</th>
                <th className="py-1 font-medium">model</th>
              </tr>
            </thead>
            <tbody>
              {diagnostics.slice(0, 8).map((d) => (
                <tr key={d.at} className="border-b border-border">
                  <td className="py-1">{d.intent}</td>
                  <td className="py-1">{d.internalCount}</td>
                  <td className="py-1">
                    {d.webCount + d.researchCount}
                    {d.sanitizedQueryCount ? ` / q${d.sanitizedQueryCount}` : ""}
                    {d.pagesFetched ? ` / p${d.pagesFetched}` : ""}
                  </td>
                  <td className="py-1">{d.contextCount}</td>
                  <td className="py-1">{d.citationCount}</td>
                  <td className="py-1">{d.citationPersistCount}</td>
                  <td className="py-1">
                    {d.modelRole ?? "—"} / {d.modelProvider}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="space-y-2">
        <h2 className="text-[14px] font-semibold">注意</h2>
        <p className="text-[13px] text-text-secondary">
          外部推論エンジンは製品本体ではありません。Research は実接続時のみ実検索になります。
          未接続時に検索完了を装いません。
        </p>
        <StatusBadge tone="neutral">業務 OS 向け診断</StatusBadge>
      </section>
    </div>
  );
}
