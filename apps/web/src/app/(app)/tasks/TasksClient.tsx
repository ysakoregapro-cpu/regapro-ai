"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  EmptyState,
  ListRow,
  PageHeader,
  StatusBadge,
} from "@/components/ui/primitives";
import { interpretTaskUtterance, type TaskDraft } from "@/lib/application/task-interpreter";
import { cn } from "@/lib/cn";
import { isDevSampleMode } from "@/lib/supabase/env";

type TaskRow = {
  id: string;
  title: string;
  description: string;
  status: string;
  priority?: string;
  projectId: string | null;
  dueAt: string;
  originThreadId?: string | null;
  confidentialityLevel?: string;
  visibility?: string;
};

const FILTERS = [
  { id: "today", label: "今日" },
  { id: "upcoming", label: "近日中" },
  { id: "all", label: "すべて" },
  { id: "done", label: "完了済み" },
] as const;

export default function TasksClient() {
  const params = useSearchParams();
  const initialFilter = (params.get("filter") as (typeof FILTERS)[number]["id"]) || "all";
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>(
    FILTERS.some((f) => f.id === initialFilter) ? initialFilter : "all",
  );
  const [selectedId, setSelectedId] = useState<string | null>(params.get("task"));
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [quick, setQuick] = useState("");
  const priorityFilter = "all";
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState(isDevSampleMode() ? "dev-sample" : "supabase");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/tasks?filter=${filter}`);
        const json = (await res.json()) as {
          ok?: boolean;
          mode?: string;
          tasks?: TaskRow[];
          message?: string;
        };
        if (cancelled) return;
        if (json.mode) setMode(json.mode);
        setTasks(json.tasks ?? []);
      } catch {
        if (!cancelled) setTasks([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filter]);

  const visible = useMemo(() => {
    if (priorityFilter === "all") return tasks;
    return tasks.filter((t) => t.priority === priorityFilter);
  }, [tasks, priorityFilter]);

  const selected = selectedId
    ? visible.find((t) => t.id === selectedId) ?? tasks.find((t) => t.id === selectedId)
    : null;

  async function createManual() {
    if (!draft) return;
    if (mode === "dev-sample") {
      setDraft(null);
      setQuick("");
      return;
    }
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: draft.title,
        description: draft.description,
      }),
    });
    const json = (await res.json()) as { ok?: boolean; task?: TaskRow };
    if (json.ok && json.task) {
      setTasks((prev) => [json.task!, ...prev]);
      setSelectedId(json.task.id);
    }
    setDraft(null);
    setQuick("");
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="タスク"
        description={
          mode === "supabase"
            ? "会話や手動作成から保存されたタスクです"
            : "担当・期限・優先度を一覧で確認します"
        }
        actions={
          <button
            type="button"
            className="h-9 rounded-md bg-accent px-3 text-[13px] font-medium text-accent-fg"
            onClick={() => setQuick("明日までに進捗を確認する")}
          >
            自然言語で追加
          </button>
        }
      />

      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!quick.trim()) return;
          setDraft(interpretTaskUtterance(quick));
        }}
      >
        <label htmlFor="task-quick" className="sr-only">
          タスクを自然言語で追加
        </label>
        <input
          id="task-quick"
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          placeholder="例）明日までに進捗を確認する"
          className="h-10 flex-1 rounded-md border border-border bg-surface px-3 text-[14px]"
        />
        <button
          type="submit"
          className="h-10 rounded-md border border-border px-3 text-[13px] hover:bg-surface-raised"
        >
          下書き
        </button>
      </form>

      {draft ? (
        <div className="rounded-md border border-border bg-surface p-3">
          <p className="text-[14px] font-medium">{draft.title}</p>
          <p className="mt-1 text-[12px] text-text-secondary">{draft.description}</p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="h-9 rounded-md bg-accent px-3 text-[13px] text-accent-fg"
              onClick={() => void createManual()}
            >
              作成
            </button>
            <button
              type="button"
              className="h-9 rounded-md px-3 text-[13px] text-text-secondary"
              onClick={() => setDraft(null)}
            >
              キャンセル
            </button>
          </div>
          {mode === "dev-sample" ? (
            <p className="mt-2 text-[11px] text-text-muted">
              確認用モードではメモリ上の解釈のみ表示します。
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={cn(
              "h-8 rounded-md px-2.5 text-[12px]",
              filter === f.id
                ? "bg-accent text-accent-fg"
                : "border border-border text-text-secondary hover:bg-surface-raised",
            )}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="py-6 text-[13px] text-text-secondary">読み込み中…</p>
      ) : visible.length === 0 ? (
        <EmptyState
          title="タスクはまだありません"
          description="アシスタントの会話から派生させるか、上の入力から作成できます。"
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
          <div>
            {visible.map((t) => (
              <ListRow
                key={t.id}
                onClick={() => setSelectedId(t.id)}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium">{t.title}</p>
                  <p className="mt-0.5 text-[12px] text-text-secondary">
                    {t.originThreadId ? "会話由来" : "手動"} · {t.status}
                  </p>
                </div>
                <StatusBadge tone="neutral">{t.dueAt.slice(0, 10)}</StatusBadge>
              </ListRow>
            ))}
          </div>
          <aside className="rounded-md border border-border p-3">
            {selected ? (
              <div className="space-y-2 text-[13px]">
                <p className="font-medium">{selected.title}</p>
                <p className="text-text-secondary">{selected.description || "詳細なし"}</p>
                <p className="text-[12px] text-text-muted">状態: {selected.status}</p>
                {selected.originThreadId ? (
                  <p className="text-[12px] text-text-muted">
                    元会話: {selected.originThreadId.slice(0, 8)}…
                  </p>
                ) : null}
                {selected.confidentialityLevel ? (
                  <p className="text-[12px] text-text-muted">
                    区分: {selected.confidentialityLevel} / {selected.visibility}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-[12px] text-text-secondary">タスクを選択してください</p>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
