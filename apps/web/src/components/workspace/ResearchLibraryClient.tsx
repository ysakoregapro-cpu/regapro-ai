"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ListRow, StatusBadge } from "@/components/ui/primitives";
import { StartResearchButton, startWorkflowClient } from "@/components/chat/WorkflowActions";
import { createDerivedViaApi } from "@/lib/application/chat-api-client";
import { isDevSampleMode } from "@/lib/supabase/env";

type LibraryItem = {
  id: string;
  title: string;
  threadId: string;
  projectLabel: string;
  status: string;
  statusLabel: string;
  levelLabel: string;
  sourceCount: number;
  updatedAt: string;
  isDemo: boolean;
};

export function ResearchLibraryClient() {
  const router = useRouter();
  const params = useSearchParams();
  const wantNew = params.get("new") === "1";
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState(wantNew);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!wantNew) return;
    let cancelled = false;
    void (async () => {
      const result = await startWorkflowClient({ workflowType: "research" });
      if (cancelled) return;
      if (result.ok) {
        router.replace(result.redirectTo);
      } else {
        setRedirecting(false);
        setToast(result.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wantNew, router]);

  useEffect(() => {
    if (wantNew) return;
    void (async () => {
      const res = await fetch("/api/research", { cache: "no-store" });
      const data = (await res.json()) as { ok: boolean; items?: LibraryItem[] };
      setItems(data.items ?? []);
      setLoading(false);
    })();
  }, [wantNew]);

  if (redirecting) {
    return (
      <p className="py-8 text-[13px] text-text-secondary">調査を準備しています…</p>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-[12px] text-text-secondary">
          完了した調査結果のライブラリです。新規調査はアシスタントで開始します。
          {isDevSampleMode()
            ? " 確認用モードでは実検索は行いません。"
            : " 公開情報の調査は接続済みの検索基盤を使います。"}
        </p>
        <StartResearchButton />
      </div>
      {toast ? <p className="mb-3 text-[12px] text-danger">{toast}</p> : null}
      {loading ? (
        <p className="text-[13px] text-text-secondary">読み込み中…</p>
      ) : items.length === 0 ? (
        <p className="py-6 text-[13px] text-text-secondary">まだ調査結果がありません</p>
      ) : (
        <div>
          {items.some((r) => r.isDemo) ? (
            <p className="mb-3 text-[12px] text-text-muted">
              確認用データが含まれる項目があります。実際のWeb検索はまだ接続されていません。
            </p>
          ) : null}
          {items.map((r) => (
            <ListRow key={r.id}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium">{r.title}</p>
                <p className="mt-0.5 text-[12px] text-text-secondary">
                  {r.projectLabel} · {r.updatedAt.slice(0, 10)} · {r.levelLabel} · 情報源{" "}
                  {r.sourceCount}
                  {r.isDemo ? " · 確認用（実検索なし）" : ""}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Link
                    href={`/assistant?thread=${r.threadId}&tool=web_research`}
                    className="text-[12px] text-accent hover:underline"
                  >
                    関連チャットを開く
                  </Link>
                  <button
                    type="button"
                    className="text-[12px] text-accent hover:underline"
                    onClick={() =>
                      void startWorkflowClient({
                        workflowType: "research",
                        initialMessage: r.title,
                      }).then((res) => {
                        if (res.ok) router.push(res.redirectTo);
                      })
                    }
                  >
                    再調査
                  </button>
                  <button
                    type="button"
                    className="text-[12px] text-accent hover:underline"
                    onClick={() => {
                      void createDerivedViaApi({
                        threadId: r.threadId,
                        kind: "knowledge_candidate",
                        title: `ナレッジ候補: ${r.title}`,
                      });
                      setToast("ナレッジ候補を追加しました");
                    }}
                  >
                    ナレッジ候補にする
                  </button>
                  <button
                    type="button"
                    className="text-[12px] text-accent hover:underline"
                    onClick={() =>
                      void startWorkflowClient({
                        workflowType: "document",
                        initialMessage: `この調査「${r.title}」を資料にして`,
                        documentSubtype: "document",
                      }).then((res) => {
                        if (res.ok) router.push(res.redirectTo);
                      })
                    }
                  >
                    ドキュメント化
                  </button>
                </div>
              </div>
              <StatusBadge tone={r.status === "completed" ? "accent" : "neutral"}>
                {r.statusLabel}
              </StatusBadge>
            </ListRow>
          ))}
        </div>
      )}
    </div>
  );
}
