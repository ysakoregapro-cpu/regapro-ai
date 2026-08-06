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
import { InformationLevelSelector } from "@/components/chat/InformationLevelSelector";
import {
  createDerivedViaApi,
  ensureThreadReply,
  fetchThreadBundle,
  fetchThreadList,
  type ThreadListItem,
} from "@/lib/application/chat-api-client";
import { listTasks, projectName } from "@/lib/application/catalog-service";
import { interpretTaskUtterance } from "@/lib/application/task-interpreter";
import { cn } from "@/lib/cn";
import { SAMPLE_DOCUMENTS } from "@/lib/data/dev-sample/catalog";
import { resolveSessionAccess } from "@/lib/data/dev-sample/memberships";
import { ASSISTANT_TOOLS } from "@/lib/navigation";
import type { ConfidentialityLevel } from "@regapro/shared";
import { CONFIDENTIALITY_LABELS } from "@regapro/shared";

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

function toLocalMessages(
  messages: { id: string; threadId: string; role: string; content: string; createdAt: string }[],
): LocalMessage[] {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      id: m.id,
      threadId: m.threadId,
      role: m.role as "user" | "assistant",
      content: m.content,
      createdAt: m.createdAt,
    }));
}

export default function AssistantPage() {
  const router = useRouter();
  const params = useSearchParams();
  const session = useMemo(() => resolveSessionAccess(), []);
  const initialThread = params.get("thread");
  const initialQuery = params.get("q") ?? "";
  const started = params.get("started") === "1";

  const [threads, setThreads] = useState<ThreadListItem[]>([]);
  const [threadId, setThreadId] = useState<string | null>(initialThread);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [threadLevel, setThreadLevel] = useState<ConfidentialityLevel>("company");
  const [threadTitle, setThreadTitle] = useState("新しい依頼");
  const [threadProjectId, setThreadProjectId] = useState<string | null>(null);
  const [loadingThread, setLoadingThread] = useState(Boolean(initialThread));
  const [input, setInput] = useState(started ? "" : initialQuery);
  const [activeTools, setActiveTools] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [rightTab, setRightTab] = useState<RightTab>("citations");
  const [feedback, setFeedback] = useState<Record<string, "up" | "down">>({});
  const [correctionOpen, setCorrectionOpen] = useState<Record<string, boolean>>({});
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [levelAdvice, setLevelAdvice] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef(false);

  const syncThreadParam = useCallback(
    (id: string | null, clearStarted = true) => {
      const next = new URLSearchParams(params.toString());
      if (id) next.set("thread", id);
      else next.delete("thread");
      next.delete("q");
      if (clearStarted) next.delete("started");
      const qs = next.toString();
      router.replace(qs ? `/assistant?${qs}` : "/assistant", { scroll: false });
    },
    [params, router]
  );

  const refreshThreadList = useCallback(async () => {
    const list = await fetchThreadList();
    setThreads(list);
    return list;
  }, []);

  const loadThread = useCallback(async (id: string, opts?: { requestReply?: boolean }) => {
    setLoadingThread(true);
    try {
      const bundle = await fetchThreadBundle(id);
      if (!bundle) {
        setMessages([]);
        setToast("会話を読み込めませんでした");
        return;
      }
      setThreadTitle(bundle.thread.title);
      setThreadLevel(bundle.thread.confidentialityLevel);
      setThreadProjectId(bundle.thread.projectId);
      let msgs = toLocalMessages(bundle.messages);
      setMessages(msgs);

      const last = msgs[msgs.length - 1];
      const needsReply = last?.role === "user";
      if (opts?.requestReply && needsReply) {
        setGenerating(true);
        const replied = await ensureThreadReply(id, `reply:${id}:${last.id}`);
        if (replied) {
          msgs = toLocalMessages(replied.messages);
          setMessages(msgs);
        }
        setGenerating(false);
        setRightTab("citations");
      }
    } finally {
      setLoadingThread(false);
    }
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void refreshThreadList();
    }, 0);
    return () => window.clearTimeout(handle);
  }, [refreshThreadList]);

  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    const handle = window.setTimeout(() => {
      void (async () => {
        await loadThread(threadId, { requestReply: started });
        if (!cancelled && started) syncThreadParam(threadId, true);
      })();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [threadId, started, loadThread, syncThreadParam]);

  const selectThread = useCallback(
    (id: string) => {
      setDrawerOpen(false);
      setLevelAdvice(null);
      setThreadId(id);
      syncThreadParam(id, true);
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
    if (!threadProjectId) return [];
    return listTasks("all").filter((t) => t.projectId === threadProjectId).slice(0, 5);
  }, [threadProjectId]);
  const relatedArtifacts = useMemo(() => {
    if (!threadProjectId) return [];
    return SAMPLE_DOCUMENTS.filter((d) => d.projectId === threadProjectId);
  }, [threadProjectId]);

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

    if (!threadId) {
      const key = crypto.randomUUID();
      const res = await fetch("/api/chat/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify({
          content: text,
          requestedLevel: threadLevel,
          idempotencyKey: key,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        threadId?: string;
        message?: string;
        restoreContent?: string;
      };
      if (!data.ok || !data.threadId) {
        if (data.restoreContent != null) setInput(data.restoreContent);
        else setInput(text);
        setToast(data.message ?? "会話を開始できませんでした");
        return;
      }
      setInput("");
      setThreadId(data.threadId);
      await refreshThreadList();
      await loadThread(data.threadId, { requestReply: true });
      syncThreadParam(data.threadId, true);
      return;
    }

    setGenerating(true);
    const kept = text;
    setInput("");
    const follow = await fetch(`/api/chat/threads/${threadId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text }),
    });
    if (!follow.ok) {
      setInput(kept);
      setToast("送信に失敗しました。入力内容は残しています。");
      setGenerating(false);
      return;
    }
    const data = (await follow.json()) as {
      messages?: { id: string; threadId: string; role: string; content: string; createdAt: string }[];
    };
    if (data.messages) setMessages(toLocalMessages(data.messages));
    setGenerating(false);
    setRightTab("citations");
    await refreshThreadList();
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
          <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[15px] font-semibold">
                {threadTitle}
              </h1>
              {threadProjectId ? (
                <p className="truncate text-[11px] text-text-secondary">
                  {projectName(threadProjectId)}
                </p>
              ) : null}
            </div>
            <InformationLevelSelector
              className="self-end sm:self-start"
              value={threadLevel}
              selectableLevels={session.selectableLevels}
              locked={session.selectableLevels.length <= 1}
              onChange={async (level) => {
                if (!threadId) {
                  setThreadLevel(level);
                  return;
                }
                const res = await fetch("/api/chat/level", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ threadId, newLevel: level }),
                });
                const data = (await res.json()) as {
                  ok: boolean;
                  message?: string;
                  advice?: string;
                };
                if (!data.ok) {
                  setLevelAdvice(data.advice ?? data.message ?? null);
                  throw new Error(data.message ?? "変更できませんでした");
                }
                setThreadLevel(level);
                setLevelAdvice(null);
                setToast(`情報区分を「${CONFIDENTIALITY_LABELS[level]}」に更新しました`);
              }}
            />
          </div>
        </header>
        {levelAdvice ? (
          <div className="border-b border-border px-3 py-2 text-[12px] text-text-secondary">
            <p>{levelAdvice}</p>
            <button
              type="button"
              className="mt-1 text-accent underline"
              onClick={() => {
                setLevelAdvice(null);
                setToast("公開用の新しい会話はホームから作成してください");
              }}
            >
              公開可能な内容を新しいスレッドへ抽出
            </button>
          </div>
        ) : null}

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-1 py-3 lg:px-3">
          {loadingThread ? (
            <p className="py-8 text-[13px] text-text-secondary">会話を読み込んでいます…</p>
          ) : messages.length === 0 ? (
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
                    if (threadId) {
                      void createDerivedViaApi({
                        threadId,
                        messageId: msg.id,
                        kind: "task",
                        title: draft.title,
                      });
                    }
                    setToast(`タスク下書き：${draft.title}（情報区分を継承）`);
                  }}
                  onKnowledgeCandidate={() => {
                    if (threadId) {
                      void createDerivedViaApi({
                        threadId,
                        messageId: msg.id,
                        kind: "knowledge_candidate",
                        title: "ナレッジ候補",
                      });
                    }
                    setToast("ナレッジ候補を追加しました（原文の個人相談は公開しません）");
                  }}
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
  threads: ThreadListItem[];
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
          <span className="text-[10px] text-text-muted">
            {t.projectId ? projectName(t.projectId) : "個人"} · {t.updatedAt.slice(0, 10)} ·{" "}
            {CONFIDENTIALITY_LABELS[t.confidentialityLevel]}
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
