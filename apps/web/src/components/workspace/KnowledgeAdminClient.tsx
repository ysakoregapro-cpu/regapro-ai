"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { EmptyState, ListRow, PageHeader } from "@/components/ui/primitives";

type DocRow = {
  id: string;
  title: string;
  status: string;
  visibility: string;
  confidentiality_level: number;
  source_type: string | null;
  updated_at: string;
  published_at: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  draft: "下書き",
  review: "レビュー中",
  approved: "承認済み",
  published: "公開",
  archived: "アーカイブ",
};

export function KnowledgeAdminClient({ mode }: { mode: "dev-sample" | "supabase" }) {
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(() => {
    startTransition(async () => {
      setError(null);
      const res = await fetch("/api/knowledge");
      if (!res.ok) {
        setError("一覧を取得できませんでした");
        return;
      }
      const json = (await res.json()) as { documents?: DocRow[] };
      setDocs(json.documents ?? []);
    });
  }, []);

  useEffect(() => {
    if (mode === "supabase") refresh();
  }, [mode, refresh]);

  function createDraft() {
    startTransition(async () => {
      setError(null);
      const res = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body }),
      });
      if (!res.ok) {
        setError("作成に失敗しました。権限と入力を確認してください。");
        return;
      }
      setTitle("");
      setBody("");
      refresh();
    });
  }

  function advance(doc: DocRow) {
    const next =
      doc.status === "draft"
        ? "review"
        : doc.status === "review"
          ? "approved"
          : doc.status === "approved"
            ? "published"
            : null;
    if (!next) return;
    startTransition(async () => {
      setError(null);
      const res = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "transition",
          documentId: doc.id,
          from: doc.status,
          to: next,
        }),
      });
      if (!res.ok) {
        setError("状態変更に失敗しました");
        return;
      }
      refresh();
    });
  }

  if (mode === "dev-sample") {
    return null;
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3 border-t border-border pt-6">
        <h2 className="text-[14px] font-medium text-text">手動でナレッジを追加</h2>
        <p className="text-[12px] text-text-secondary">
          下書き → レビュー → 承認 → 公開の順。公開時に検索用チャンクを生成します。
        </p>
        <label className="block text-[12px] text-text-secondary">
          タイトル
          <input
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-[14px] text-text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
          />
        </label>
        <label className="block text-[12px] text-text-secondary">
          本文
          <textarea
            className="mt-1 min-h-[120px] w-full rounded-md border border-border bg-surface px-3 py-2 text-[14px] text-text"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="rounded-md bg-accent px-4 py-2 text-[14px] text-white disabled:opacity-50"
          disabled={pending || !title.trim() || !body.trim()}
          onClick={createDraft}
        >
          下書きを作成
        </button>
        {error ? (
          <p className="text-[12px] text-red-700" role="alert">
            {error}
          </p>
        ) : null}
      </section>

      <section className="space-y-2">
        <h2 className="text-[14px] font-medium text-text">管理中のナレッジ</h2>
        {docs.length === 0 ? (
          <EmptyState
            title="まだナレッジがありません"
            description="上のフォームから下書きを作成してください。"
          />
        ) : (
          docs.map((d) => (
            <ListRow key={d.id}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium">{d.title}</p>
                <p className="text-[12px] text-text-secondary">
                  {STATUS_LABEL[d.status] ?? d.status} · {d.visibility} · L
                  {d.confidentiality_level}
                </p>
              </div>
              {d.status === "draft" ||
              d.status === "review" ||
              d.status === "approved" ? (
                <button
                  type="button"
                  className="shrink-0 text-[13px] text-accent underline-offset-2 hover:underline disabled:opacity-50"
                  disabled={pending}
                  onClick={() => advance(d)}
                >
                  {d.status === "draft"
                    ? "レビューへ"
                    : d.status === "review"
                      ? "承認する"
                      : "公開する"}
                </button>
              ) : null}
            </ListRow>
          ))
        )}
      </section>
    </div>
  );
}

export function KnowledgePageHeader({
  mode,
  sampleRows,
}: {
  mode: "dev-sample" | "supabase";
  sampleRows: readonly {
    id: string;
    title: string;
    category: string;
    business: string;
  }[];
}) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="ナレッジ"
        description={
          mode === "dev-sample"
            ? "承認済みナレッジの一覧です"
            : "公開ナレッジの管理と検索投入。AI回答は公開済み・権限内のみ参照します。"
        }
      />
      {mode === "dev-sample" ? (
        sampleRows.length === 0 ? (
          <EmptyState
            title="表示できるナレッジはありません"
            description=""
          />
        ) : (
          sampleRows.map((k) => (
            <ListRow key={k.id}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium">{k.title}</p>
                <p className="text-[12px] text-text-secondary">
                  {k.category} · {k.business}
                </p>
              </div>
            </ListRow>
          ))
        )
      ) : (
        <KnowledgeAdminClient mode={mode} />
      )}
    </div>
  );
}
