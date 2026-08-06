"use client";

import {
  Copy,
  FileText,
  ListTodo,
  Menu,
  Mic,
  Paperclip,
  Send,
  Square,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, ListRow, StatusBadge } from "@/components/ui/primitives";
import {
  getThreadMessages,
  listTasks,
  listThreads,
  projectName,
} from "@/lib/application/catalog-service";
import { interpretTaskUtterance } from "@/lib/application/task-interpreter";
import { cn } from "@/lib/cn";
import { SAMPLE_DOCUMENTS } from "@/lib/data/dev-sample/catalog";
import { ASSISTANT_TOOLS } from "@/lib/navigation";

type LocalMessage = {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  citations?: readonly { id: string; title: string; source: string }[];
};

type ArtifactItem = {
  id: string;
  title: string;
  kind: string;
  projectId: string;
  updatedAt: string;
};

type RightTab = "citations" | "tasks" | "artifacts";

export default function AssistantPage() {
  const router = useRouter();
  const params = useSearchParams();
  const threads = useMemo(() => listThreads(), []);
  const initialThread = params.get("thread") ?? threads[0]?.id ?? null;
  const initialQuery = params.get("q") ?? "";

  const [threadId, setThreadId] = useState<string | null>(initialThread);
  const [messages, setMessages] = useState<LocalMessage[]>(() =>
    initialThread ? (getThreadMessages(initialThread) as LocalMessage[]) : []
  );
  const [input, setInput] = useState(initialQuery);
  const [activeTools, setActiveTools] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [rightTab, setRightTab] = useState<RightTab>("citations");
  const [feedback, setFeedback] = useState<Record<string, "up" | "down">>({});
  const [correctionOpen, setCorrectionOpen] = useState<Record<string, boolean>>({});
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef(false);

  const activeThread = threads.find((t) => t.id === threadId) ?? null;

  const syncThreadParam = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (id) next.set("thread", id);
      else next.delete("thread");
      next.delete("q");
      const qs = next.toString();
      router.replace(qs ? `/assistant?${qs}` : "/assistant", { scroll: false });
    },
    [params, router]
  );

  const selectThread = useCallback(
    (id: string) => {
      setThreadId(id);
      setMessages(getThreadMessages(id) as LocalMessage[]);
      setDrawerOpen(false);
      syncThreadParam(id);
    },
    [syncThreadParam]
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, generating]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2400);
    return () => window.clearTimeout(t);
  }, [toast]);

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const citations = lastAssistant?.citations ?? [];
  const relatedTasks = useMemo(() => {
    if (!activeThread) return [];
    return listTasks("all").filter((t) => t.projectId === activeThread.projectId).slice(0, 5);
  }, [activeThread]);
  const relatedArtifacts = useMemo(() => {
    if (!activeThread) return [];
    return SAMPLE_DOCUMENTS.filter((d) => d.projectId === activeThread.projectId);
  }, [activeThread]);

  const toggleTool = (id: string) => {
    setActiveTools((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const stopGenerating = () => {
    abortRef.current = true;
    setGenerating(false);
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || generating) return;

    let currentThreadId = threadId;
    if (!currentThreadId) {
      currentThreadId = `thread-new-${Date.now()}`;
      setThreadId(currentThreadId);
      syncThreadParam(currentThreadId);
    }

    const userMsg: LocalMessage = {
      id: `msg-u-${Date.now()}`,
      threadId: currentThreadId,
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setGenerating(true);
    abortRef.current = false;

    await new Promise((r) => setTimeout(r, 700));
    if (abortRef.current) return;

    const toolLabel = activeTools.length
      ? ASSISTANT_TOOLS.filter((t) => activeTools.includes(t.id))
          .map((t) => t.label)
          .join("、")
      : "社内情報";

    const assistantMsg: LocalMessage = {
      id: `msg-a-${Date.now()}`,
      threadId: currentThreadId,
      role: "assistant",
      content: `「${text}」について、${toolLabel}を参照して整理しました。\n\n要点を3行でまとめ、次のアクション案を右ペインに載せています。詳細が必要な場合は続けて指示してください。`,
      createdAt: new Date().toISOString(),
      citations: citations.length
        ? citations
        : [
            { id: "cite-auto-1", title: "関連ナレッジ（自動抽出）", source: "ナレッジ" },
            { id: "cite-auto-2", title: "直近ドキュメント", source: "ドキュメント" },
          ],
    };

    setMessages((prev) => [...prev, assistantMsg]);
    setGenerating(false);
    setRightTab("citations");
  };

  const copyMessage = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setToast("コピーしました");
    } catch {
      setToast("コピーに失敗しました");
    }
  };

  return (
    <div className="flex h-[calc(100dvh-var(--header-height)-var(--mobile-nav-height)-40px)] min-h-[420px] flex-col overflow-hidden lg:flex-row">
      {/* Desktop thread list */}
      <aside className="hidden w-[240px] shrink-0 flex-col border-r border-border lg:flex">
        <ThreadListHeader onNew={() => setToast("新しいスレッドを開始しました")} />
        <ThreadList
          threads={threads}
          activeId={threadId}
          onSelect={selectThread}
          className="min-h-0 flex-1 overflow-y-auto"
        />
      </aside>

      {/* Mobile thread drawer */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-[var(--z-drawer)] lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/30"
            aria-label="スレッド一覧を閉じる"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-[min(300px,88vw)] flex-col bg-surface shadow-[var(--shadow-menu)]">
            <div className="flex items-center justify-between border-b border-border px-3 py-3">
              <p className="text-[14px] font-semibold">スレッド</p>
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-surface-raised"
                aria-label="閉じる"
                onClick={() => setDrawerOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <ThreadList
              threads={threads}
              activeId={threadId}
              onSelect={selectThread}
              className="min-h-0 flex-1 overflow-y-auto"
            />
          </aside>
        </div>
      ) : null}

      {/* Conversation */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b border-border px-1 py-2 lg:px-2">
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-surface-raised lg:hidden"
            aria-label="スレッド一覧"
            onClick={() => setDrawerOpen(true)}
          >
            <Menu className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-semibold">
              {activeThread?.title ?? "新しい依頼"}
            </h1>
            {activeThread ? (
              <p className="truncate text-[11px] text-text-secondary">
                {projectName(activeThread.projectId)}
              </p>
            ) : null}
          </div>
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-1 py-3 lg:px-3">
          {messages.length === 0 ? (
            <EmptyState
              title="依頼内容を入力してください"
              description="社内情報の整理、文面作成、タスク化などをこの画面から進められます"
            />
          ) : (
            <div className="mx-auto max-w-3xl space-y-4">
              {messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  feedback={feedback[msg.id]}
                  correctionOpen={Boolean(correctionOpen[msg.id])}
                  correction={corrections[msg.id] ?? ""}
                  onCopy={() => copyMessage(msg.content)}
                  onHelpful={() =>
                    setFeedback((f) => {
                      const next = { ...f };
                      if (next[msg.id] === "up") delete next[msg.id];
                      else next[msg.id] = "up";
                      return next;
                    })
                  }
                  onNeedsImprovement={() =>
                    setFeedback((f) => {
                      const next = { ...f };
                      if (next[msg.id] === "down") delete next[msg.id];
                      else next[msg.id] = "down";
                      return next;
                    })
                  }
                  onToggleCorrection={() =>
                    setCorrectionOpen((o) => ({ ...o, [msg.id]: !o[msg.id] }))
                  }
                  onCorrectionChange={(v) => setCorrections((c) => ({ ...c, [msg.id]: v }))}
                  onMakeTask={() => {
                    const draft = interpretTaskUtterance(msg.content);
                    setToast(`タスク下書き：${draft.title}`);
                  }}
                  onKnowledgeCandidate={() => setToast("ナレッジ候補に追加しました")}
                  onOpenArtifact={() => setRightTab("artifacts")}
                />
              ))}
              {generating ? (
                <p className="text-[12px] text-text-secondary" aria-live="polite">
                  回答を作成しています…
                </p>
              ) : null}
            </div>
          )}
        </div>

        <Composer
          input={input}
          onInputChange={setInput}
          activeTools={activeTools}
          onToggleTool={toggleTool}
          generating={generating}
          onSend={() => void sendMessage()}
          onStop={stopGenerating}
        />
      </section>

      {/* Right pane */}
      <aside className="hidden w-[var(--right-pane-width)] shrink-0 flex-col border-l border-border lg:flex">
        <div className="flex shrink-0 gap-1 border-b border-border px-2 py-2">
          {(
            [
              { id: "citations", label: "引用" },
              { id: "tasks", label: "タスク" },
              { id: "artifacts", label: "成果物" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setRightTab(tab.id)}
              className={cn(
                "h-8 rounded-md px-2.5 text-[12px]",
                rightTab === tab.id
                  ? "bg-accent-muted font-medium text-accent"
                  : "text-text-secondary hover:bg-surface-raised"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <RightPane
          tab={rightTab}
          citations={citations}
          tasks={relatedTasks}
          artifacts={relatedArtifacts}
        />
      </aside>

      {toast ? (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed bottom-[calc(var(--mobile-nav-height)+72px)] left-1/2 z-[var(--z-toast)] -translate-x-1/2 rounded-md border border-border bg-surface px-3 py-2 text-[12px] shadow-[var(--shadow-menu)] lg:bottom-6"
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}

function ThreadListHeader({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-3">
      <p className="text-[13px] font-semibold">スレッド</p>
      <button
        type="button"
        onClick={onNew}
        className="h-8 rounded-md border border-border px-2 text-[12px] hover:bg-surface-raised"
      >
        新規
      </button>
    </div>
  );
}

function ThreadList({
  threads,
  activeId,
  onSelect,
  className,
}: {
  threads: ReturnType<typeof listThreads>;
  activeId: string | null;
  onSelect: (id: string) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      {threads.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onSelect(t.id)}
          className={cn(
            "flex w-full flex-col gap-0.5 border-b border-border px-3 py-2.5 text-left hover:bg-surface-raised",
            activeId === t.id && "bg-accent-muted/40"
          )}
        >
          <span className="truncate text-[13px] font-medium">{t.title}</span>
          <span className="truncate text-[11px] text-text-secondary">{t.preview}</span>
          <span className="text-[10px] text-text-muted">
            {projectName(t.projectId)} · {t.updatedAt.slice(0, 10)}
          </span>
        </button>
      ))}
    </div>
  );
}

function MessageBubble({
  message,
  feedback,
  correctionOpen,
  correction,
  onCopy,
  onHelpful,
  onNeedsImprovement,
  onToggleCorrection,
  onCorrectionChange,
  onMakeTask,
  onKnowledgeCandidate,
  onOpenArtifact,
}: {
  message: LocalMessage;
  feedback?: "up" | "down";
  correctionOpen: boolean;
  correction: string;
  onCopy: () => void;
  onHelpful: () => void;
  onNeedsImprovement: () => void;
  onToggleCorrection: () => void;
  onCorrectionChange: (value: string) => void;
  onMakeTask: () => void;
  onKnowledgeCandidate: () => void;
  onOpenArtifact: () => void;
}) {
  const isUser = message.role === "user";

  return (
    <article className={cn("group", isUser ? "flex justify-end" : "")}>
      <div
        className={cn(
          "max-w-[92%] rounded-[10px] border px-3 py-2.5 sm:max-w-[85%]",
          isUser
            ? "border-border bg-surface-sunken"
            : "border-border bg-surface"
        )}
      >
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{message.content}</p>
        <p className="mt-1 text-[10px] text-text-muted">
          {message.createdAt.replace("T", " ").slice(0, 16)}
        </p>

        {!isUser ? (
          <>
            <div className="mt-2 flex flex-wrap gap-1 opacity-100 lg:opacity-80 lg:group-hover:opacity-100">
              <ActionChip icon={<Copy className="h-3 w-3" />} label="コピー" onClick={onCopy} />
              <ActionChip
                icon={<ThumbsUp className="h-3 w-3" />}
                label="役に立った"
                active={feedback === "up"}
                onClick={onHelpful}
              />
              <ActionChip
                icon={<ThumbsDown className="h-3 w-3" />}
                label="改善が必要"
                active={feedback === "down"}
                onClick={onNeedsImprovement}
              />
              <ActionChip label="修正" onClick={onToggleCorrection} active={correctionOpen} />
              <ActionChip
                icon={<ListTodo className="h-3 w-3" />}
                label="タスク化"
                onClick={onMakeTask}
              />
              <ActionChip label="ナレッジ候補" onClick={onKnowledgeCandidate} />
              <ActionChip
                icon={<FileText className="h-3 w-3" />}
                label="成果物を開く"
                onClick={onOpenArtifact}
              />
            </div>

            {correctionOpen ? (
              <form
                className="mt-2 space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  onToggleCorrection();
                }}
              >
                <label htmlFor={`corr-${message.id}`} className="sr-only">
                  修正内容
                </label>
                <textarea
                  id={`corr-${message.id}`}
                  value={correction}
                  onChange={(e) => onCorrectionChange(e.target.value)}
                  placeholder="望ましい回答内容を入力"
                  rows={3}
                  className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-[12px]"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    className="h-8 rounded-md px-2 text-[12px] text-text-secondary"
                    onClick={onToggleCorrection}
                  >
                    キャンセル
                  </button>
                  <button
                    type="submit"
                    className="h-8 rounded-md bg-accent px-2.5 text-[12px] text-accent-fg"
                  >
                    送信
                  </button>
                </div>
              </form>
            ) : null}
          </>
        ) : null}
      </div>
    </article>
  );
}

function ActionChip({
  label,
  icon,
  onClick,
  active,
}: {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] hover:bg-surface-raised",
        active && "border-accent/40 bg-accent-muted text-accent"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function Composer({
  input,
  onInputChange,
  activeTools,
  onToggleTool,
  generating,
  onSend,
  onStop,
}: {
  input: string;
  onInputChange: (v: string) => void;
  activeTools: string[];
  onToggleTool: (id: string) => void;
  generating: boolean;
  onSend: () => void;
  onStop: () => void;
}) {
  return (
    <div
      className="shrink-0 border-t border-border bg-bg px-1 pb-2 pt-2 lg:px-3"
      style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}
    >
      <div className="mx-auto max-w-3xl">
        <div className="mb-2 flex flex-wrap gap-1">
          {ASSISTANT_TOOLS.map((tool) => (
            <button
              key={tool.id}
              type="button"
              onClick={() => onToggleTool(tool.id)}
              className={cn(
                "h-7 rounded-full border px-2 text-[11px]",
                activeTools.includes(tool.id)
                  ? "border-accent/30 bg-accent-muted text-accent"
                  : "border-border text-text-secondary hover:bg-surface-raised"
              )}
            >
              {tool.label}
            </button>
          ))}
        </div>

        <div className="flex items-end gap-1.5 rounded-[10px] border border-border bg-surface p-1.5">
          <button
            type="button"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-text-secondary hover:bg-surface-raised"
            aria-label="ファイルを添付"
          >
            <Paperclip className="h-4 w-4" />
          </button>

          <label htmlFor="assistant-input" className="sr-only">
            依頼内容
          </label>
          <textarea
            id="assistant-input"
            rows={1}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder="依頼内容を入力…（Shift+Enter で改行）"
            className="max-h-32 min-h-[36px] flex-1 resize-none bg-transparent px-1 py-2 text-[13px] outline-none"
          />

          <button
            type="button"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-text-secondary hover:bg-surface-raised"
            aria-label="音声入力"
          >
            <Mic className="h-4 w-4" />
          </button>

          {generating ? (
            <button
              type="button"
              onClick={onStop}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border hover:bg-surface-raised"
              aria-label="停止"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onSend}
              disabled={!input.trim()}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent text-accent-fg disabled:opacity-40"
              aria-label="送信"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function RightPane({
  tab,
  citations,
  tasks,
  artifacts,
}: {
  tab: RightTab;
  citations: readonly { id: string; title: string; source: string }[];
  tasks: ReturnType<typeof listTasks>;
  artifacts: ArtifactItem[];
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
      {tab === "citations" ? (
        citations.length === 0 ? (
          <p className="px-1 py-4 text-[12px] text-text-secondary">引用はまだありません</p>
        ) : (
          citations.map((c) => (
            <ListRow key={c.id} className="px-1">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px]">{c.title}</p>
                <StatusBadge>{c.source}</StatusBadge>
              </div>
            </ListRow>
          ))
        )
      ) : null}

      {tab === "tasks" ? (
        tasks.length === 0 ? (
          <p className="px-1 py-4 text-[12px] text-text-secondary">関連タスクはありません</p>
        ) : (
          tasks.map((t) => (
            <ListRow key={t.id} href={`/tasks?task=${t.id}`} className="px-1">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px]">{t.title}</p>
                <p className="text-[11px] text-text-secondary">{t.dueAt.slice(0, 10)}</p>
              </div>
            </ListRow>
          ))
        )
      ) : null}

      {tab === "artifacts" ? (
        artifacts.length === 0 ? (
          <p className="px-1 py-4 text-[12px] text-text-secondary">成果物はありません</p>
        ) : (
          artifacts.map((a) => (
            <ListRow key={a.id} href="/workspace/documents" className="px-1">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px]">{a.title}</p>
                <p className="text-[11px] text-text-secondary">
                  {a.kind} · {a.updatedAt}
                </p>
              </div>
            </ListRow>
          ))
        )
      ) : null}
    </div>
  );
}
