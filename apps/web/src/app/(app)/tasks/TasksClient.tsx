"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  EmptyState,
  ListRow,
  PageHeader,
  StatusBadge,
} from "@/components/ui/primitives";
import {
  getTask,
  listTasks,
  projectName,
  userName,
} from "@/lib/application/catalog-service";
import { interpretTaskUtterance, type TaskDraft } from "@/lib/application/task-interpreter";
import { cn } from "@/lib/cn";
import type { SampleTask } from "@/lib/data/dev-sample/catalog";

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
    FILTERS.some((f) => f.id === initialFilter) ? initialFilter : "all"
  );
  const [selectedId, setSelectedId] = useState<string | null>(params.get("task"));
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [quick, setQuick] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");

  const tasks = useMemo(() => {
    let list = listTasks(filter);
    if (priorityFilter !== "all") {
      list = list.filter((t) => t.priority === priorityFilter);
    }
    return list;
  }, [filter, priorityFilter]);

  const selected = selectedId ? getTask(selectedId) : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="タスク"
        description="担当・期限・優先度を一覧で確認します"
        actions={
          <button
            type="button"
            className="h-9 rounded-md bg-accent px-3 text-[13px] font-medium text-accent-fg"
            onClick={() => setQuick("明日までに田中さんへ求人選定状況を確認")}
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
          placeholder="例）明日までに田中さんへ求人選定状況を確認"
          className="h-10 flex-1 rounded-md border border-border bg-surface px-3 text-[14px]"
        />
        <button
          type="submit"
          className="h-10 rounded-md border border-border px-3 text-[13px] hover:bg-surface-raised"
        >
          下書きを作成
        </button>
      </form>

      {draft ? <TaskDraftCard draft={draft} onClose={() => setDraft(null)} /> : null}

      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={cn(
              "h-8 rounded-md px-2.5 text-[12px]",
              filter === f.id
                ? "bg-accent-muted font-medium text-accent"
                : "text-text-secondary hover:bg-surface-raised"
            )}
          >
            {f.label}
          </button>
        ))}
        <select
          aria-label="優先度フィルター"
          className="ml-auto h-8 rounded-md border border-border bg-surface px-2 text-[12px]"
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
        >
          <option value="all">優先度：すべて</option>
          <option value="urgent">至急</option>
          <option value="high">高</option>
          <option value="normal">通常</option>
          <option value="low">低</option>
        </select>
      </div>

      <div className="flex gap-4">
        <div className="min-w-0 flex-1">
          {tasks.length === 0 ? (
            <EmptyState title="該当するタスクはありません" />
          ) : (
            tasks.map((t) => (
              <TaskListRow
                key={t.id}
                task={t}
                active={selectedId === t.id}
                onSelect={() => setSelectedId(t.id)}
              />
            ))
          )}
        </div>

        {selected ? (
          <TaskDetail
            task={selected}
            onClose={() => setSelectedId(null)}
            className="hidden w-[340px] shrink-0 lg:block"
          />
        ) : null}
      </div>

      {selected ? (
        <div className="fixed inset-0 z-[50] bg-black/30 lg:hidden" onClick={() => setSelectedId(null)}>
          <div
            className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-[12px] bg-surface p-4 shadow-[var(--shadow-modal)]"
            style={{ paddingBottom: "calc(16px + env(safe-area-inset-bottom))" }}
            onClick={(e) => e.stopPropagation()}
          >
            <TaskDetail task={selected} onClose={() => setSelectedId(null)} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TaskListRow({
  task,
  active,
  onSelect,
}: {
  task: SampleTask;
  active: boolean;
  onSelect: () => void;
}) {
  const priorityLabel =
    { low: "低", normal: "通常", high: "高", urgent: "至急" }[task.priority] ?? task.priority;

  return (
    <ListRow
      onClick={onSelect}
      className={cn(active && "bg-accent-muted/40")}
    >
      <input
        type="checkbox"
        checked={task.status === "done"}
        readOnly
        aria-label="完了"
        className="h-4 w-4 accent-[var(--color-accent)]"
      />
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-[14px]", task.status === "done" && "line-through text-text-secondary")}>
          {task.title}
        </p>
        <p className="mt-0.5 truncate text-[12px] text-text-secondary">
          {userName(task.assigneeId)} · {projectName(task.projectId)}
        </p>
      </div>
      <div className="hidden flex-col items-end gap-1 sm:flex">
        <span className="text-[12px] text-text-secondary">{task.dueAt.slice(0, 10)}</span>
        <StatusBadge tone={task.priority === "urgent" ? "danger" : "neutral"}>
          {priorityLabel}
        </StatusBadge>
      </div>
      {task.notifyDayBefore ? (
        <span className="hidden text-[10px] text-text-muted md:inline" title="期限前日に通知">
          通知
        </span>
      ) : null}
    </ListRow>
  );
}

function TaskDetail({
  task,
  onClose,
  className,
}: {
  task: SampleTask;
  onClose: () => void;
  className?: string;
}) {
  return (
    <aside className={cn("border-l border-border pl-4", className)}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <h2 className="text-[16px] font-semibold leading-snug">{task.title}</h2>
        <button type="button" className="text-[12px] text-text-secondary" onClick={onClose}>
          閉じる
        </button>
      </div>
      <dl className="space-y-3 text-[13px]">
        <Item label="説明" value={task.description} />
        <Item label="状態" value={task.status} />
        <Item label="優先度" value={task.priority} />
        <Item label="担当者" value={userName(task.assigneeId)} />
        <Item label="期限" value={task.dueAt.replace("T", " ").slice(0, 16)} />
        <Item label="通知" value={task.notifyDayBefore ? "期限前日 09:00" : "なし"} />
        <Item label="プロジェクト" value={projectName(task.projectId)} />
        <Item label="作成元" value={task.createdFrom} />
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        {["完了", "再開", "期限変更", "担当変更", "優先度変更", "キャンセル"].map((label) => (
          <button
            key={label}
            type="button"
            className="h-8 rounded-md border border-border px-2.5 text-[12px] hover:bg-surface-raised"
          >
            {label}
          </button>
        ))}
      </div>
    </aside>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-text-secondary">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}

function TaskDraftCard({ draft, onClose }: { draft: TaskDraft; onClose: () => void }) {
  return (
    <div className="rounded-[10px] border border-border bg-surface p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[14px] font-semibold">タスク下書きの確認</p>
        <StatusBadge tone="accent">確信度 {Math.round(draft.confidence * 100)}%</StatusBadge>
      </div>
      <dl className="grid gap-2 text-[13px] sm:grid-cols-2">
        <Item label="タイトル" value={draft.title} />
        <Item label="担当者" value={draft.assigneeHint ?? "未設定"} />
        <Item label="期限" value={draft.dueHint ?? "未設定"} />
        <Item label="プロジェクト" value={draft.projectHint ?? "未設定"} />
        <Item label="優先度" value={draft.priority} />
        <Item label="通知" value={draft.notifyDayBefore ? "期限前日" : "なし"} />
        <Item label="説明" value={draft.description || "—"} />
      </dl>
      <p className="mt-2 text-[12px] text-text-secondary">
        初期設定では登録前に確認が必要です。自動登録は設定で明示的に有効化できます。
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" className="h-9 rounded-md px-3 text-[13px] text-text-secondary" onClick={onClose}>
          破棄
        </button>
        <button type="button" className="h-9 rounded-md bg-accent px-3 text-[13px] text-accent-fg" onClick={onClose}>
          登録する
        </button>
      </div>
    </div>
  );
}
