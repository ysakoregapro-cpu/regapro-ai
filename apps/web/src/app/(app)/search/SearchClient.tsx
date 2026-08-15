"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ListRow, PageHeader, StatusBadge, EmptyState } from "@/components/ui/primitives";
import { searchAll } from "@/lib/application/catalog-service";
import { isDevSampleMode } from "@/lib/supabase/env";

export default function SearchClient() {
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [kind, setKind] = useState("all");
  const sample = isDevSampleMode();
  const hits = useMemo(() => {
    if (!sample) return [];
    const all = searchAll(q);
    if (kind === "all") return all;
    return all.filter((h) => h.kind === kind);
  }, [q, kind, sample]);

  const kinds = ["all", "タスク", "ナレッジ", "チャット", "ドキュメント", "プロンプト", "プロジェクト"];

  return (
    <div className="space-y-6">
      <PageHeader
        title="検索"
        description={
          sample
            ? "チャット・タスク・ナレッジ・調査などを横断します"
            : "横断検索の本番接続は今後拡張します。会話はアシスタントから探せます。"
        }
      />
      {!sample ? (
        <EmptyState
          title="横断検索は段階導入中です"
          description="supabase mode では確認用サンプル検索結果は出しません。タスク・会話・成果物は各画面から確認してください。"
        />
      ) : (
        <div className="mx-auto max-w-2xl">
          <label htmlFor="global-search" className="sr-only">
            検索キーワード
          </label>
          <input
            id="global-search"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="キーワードを入力（例：求人、イベント、タスク）"
            className="h-12 w-full rounded-md border border-border bg-surface px-4 text-[16px] outline-none focus:border-accent"
          />
          <div className="mt-3 flex flex-wrap gap-1.5">
            {kinds.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={
                  kind === k
                    ? "h-8 rounded-md bg-accent px-2.5 text-[12px] text-accent-fg"
                    : "h-8 rounded-md border border-border px-2.5 text-[12px] text-text-secondary"
                }
              >
                {k === "all" ? "すべて" : k}
              </button>
            ))}
          </div>
          <div className="mt-6">
            {hits.length === 0 ? (
              <EmptyState title="結果がありません" description="別のキーワードを試してください。" />
            ) : (
              hits.map((h) => (
                <ListRow key={`${h.kind}-${h.id}`}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium">{h.title}</p>
                    <p className="text-[12px] text-text-secondary">{h.snippet}</p>
                  </div>
                  <StatusBadge tone="neutral">{h.kind}</StatusBadge>
                </ListRow>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
