"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ListRow, PageHeader, StatusBadge, EmptyState } from "@/components/ui/primitives";
import { searchAll } from "@/lib/application/catalog-service";

export default function SearchClient() {
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [kind, setKind] = useState("all");
  const hits = useMemo(() => {
    const all = searchAll(q);
    if (kind === "all") return all;
    return all.filter((h) => h.kind === kind);
  }, [q, kind]);

  const kinds = ["all", "タスク", "ナレッジ", "チャット", "ドキュメント", "プロンプト", "プロジェクト"];

  return (
    <div className="space-y-6">
      <PageHeader title="検索" description="チャット・タスク・ナレッジ・調査などを横断します" />
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
              className={`rounded-full px-2.5 py-1 text-[12px] ${
                kind === k
                  ? "bg-accent-muted text-accent"
                  : "text-text-secondary hover:bg-surface-raised"
              }`}
            >
              {k === "all" ? "すべて" : k}
            </button>
          ))}
        </div>
      </div>

      <div>
        {!q.trim() ? (
          <p className="py-8 text-center text-[13px] text-text-secondary">
            検索語を入力するか、⌘K でコマンドパレットを開けます
          </p>
        ) : hits.length === 0 ? (
          <EmptyState title="該当する結果がありません" description="別のキーワードを試してください" />
        ) : (
          hits.map((h) => (
            <ListRow key={`${h.kind}-${h.id}`} href={hrefFor(h.kind, h.id)}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <StatusBadge>{h.kind}</StatusBadge>
                  <p className="truncate text-[14px] font-medium">{h.title}</p>
                </div>
                <p className="mt-1 truncate text-[12px] text-text-secondary">{h.snippet}</p>
                <p className="mt-0.5 text-[11px] text-text-muted">
                  {h.project} · {h.updatedAt} · {h.source}
                </p>
              </div>
            </ListRow>
          ))
        )}
      </div>
    </div>
  );
}

function hrefFor(kind: string, id: string): string {
  switch (kind) {
    case "タスク":
      return `/tasks?task=${id}`;
    case "チャット":
      return `/assistant?thread=${id}`;
    case "ナレッジ":
      return "/workspace/knowledge";
    case "ドキュメント":
      return "/workspace/documents";
    case "プロンプト":
      return "/workspace/prompts";
    case "プロジェクト":
      return `/workspace/projects?id=${id}`;
    default:
      return "/search";
  }
}
