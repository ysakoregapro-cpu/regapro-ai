"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, ChevronDown, FolderKanban, Menu, Plus, Search, User } from "lucide-react";
import { isDevSampleMode } from "@/lib/supabase/env";
import { SAMPLE_NOTIFICATIONS, SAMPLE_PROJECTS } from "@/lib/data/dev-sample/catalog";
import { cn } from "@/lib/cn";

export function TopBar({
  title,
  onOpenCommand,
}: {
  title?: string;
  onOpenCommand?: () => void;
}) {
  return (
    <header className="sticky top-0 z-[20] flex h-12 items-center gap-2 border-b border-border bg-surface/95 px-3 backdrop-blur-sm md:px-4">
      <button
        type="button"
        className="inline-flex h-10 w-10 items-center justify-center rounded-md text-text-secondary hover:bg-surface-raised md:hidden"
        aria-label="メニュー"
      >
        <Menu className="h-5 w-5" />
      </button>
      {title ? (
        <p className="truncate text-[14px] font-medium text-text md:hidden">{title}</p>
      ) : null}
      <div className="ml-auto flex items-center gap-1">
        <ProjectSwitcher />
        <GlobalCreateMenu />
        <button
          type="button"
          onClick={onOpenCommand}
          className="hidden h-9 items-center gap-2 rounded-md border border-border px-2.5 text-[12px] text-text-secondary hover:bg-surface-raised sm:inline-flex"
          aria-label="コマンドパレット"
        >
          <Search className="h-3.5 w-3.5" />
          <span>検索</span>
          <kbd className="rounded border border-border px-1 text-[10px]">⌘K</kbd>
        </button>
        <NotificationCenter />
        <ProfileMenu />
      </div>
    </header>
  );
}

function ProjectSwitcher() {
  const [open, setOpen] = useState(false);
  const projects = isDevSampleMode() ? SAMPLE_PROJECTS : [];
  return (
    <div className="relative hidden md:block">
      <button
        type="button"
        className="inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-[12px] text-text-secondary hover:bg-surface-raised"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <FolderKanban className="h-3.5 w-3.5" />
        プロジェクト
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-[40] mt-1 w-56 rounded-[12px] border border-border bg-surface py-1 shadow-[var(--shadow-menu)]"
        >
          {projects.length === 0 ? (
            <p className="px-3 py-2 text-[12px] text-text-secondary">
              表示できるプロジェクトはまだありません
            </p>
          ) : (
            projects.map((p) => (
              <Link
                key={p.id}
                href={`/workspace/projects?id=${p.id}`}
                className="block px-3 py-2 text-[13px] hover:bg-surface-raised"
                role="menuitem"
                onClick={() => setOpen(false)}
              >
                {p.name}
              </Link>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function GlobalCreateMenu() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function startResearch() {
    setPending(true);
    setOpen(false);
    try {
      const key = crypto.randomUUID();
      const res = await fetch("/api/chat/workflow", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify({ workflowType: "research", idempotencyKey: key }),
      });
      const data = (await res.json()) as { ok: boolean; redirectTo?: string };
      if (data.ok && data.redirectTo) router.push(data.redirectTo);
    } finally {
      setPending(false);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setOpen(false);
    const res = await fetch("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        createThread: true,
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      }),
    });
    const data = (await res.json()) as {
      ok: boolean;
      redirectTo?: string | null;
      threadId?: string;
    };
    if (data.ok && data.redirectTo) router.push(data.redirectTo);
    else if (data.ok && data.threadId) {
      router.push(`/assistant?thread=${data.threadId}&tool=attach_file&focus=1`);
    }
  }

  return (
    <div className="relative">
      <input
        ref={fileRef}
        type="file"
        className="sr-only"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      <button
        type="button"
        className="inline-flex h-9 items-center gap-1 rounded-md bg-accent px-2.5 text-[12px] font-medium text-accent-fg hover:bg-accent-hover"
        aria-expanded={open}
        disabled={pending}
        onClick={() => setOpen((v) => !v)}
      >
        <Plus className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">新規</span>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-[40] mt-1 w-52 rounded-[12px] border border-border bg-surface py-1 shadow-[var(--shadow-menu)]"
        >
          <Link
            href="/assistant"
            className="block px-3 py-2 text-[13px] hover:bg-surface-raised"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            新しいチャット
          </Link>
          <button
            type="button"
            role="menuitem"
            className="block w-full px-3 py-2 text-left text-[13px] hover:bg-surface-raised"
            onClick={() => void startResearch()}
          >
            詳細調査を開始
          </button>
          <button
            type="button"
            role="menuitem"
            className="block w-full px-3 py-2 text-left text-[13px] hover:bg-surface-raised"
            onClick={() => fileRef.current?.click()}
          >
            ファイルを追加
          </button>
        </div>
      ) : null}
    </div>
  );
}

function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const notifications = isDevSampleMode() ? SAMPLE_NOTIFICATIONS : [];
  const unread = notifications.filter((n) => !n.read).length;
  return (
    <div className="relative">
      <button
        type="button"
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-md text-text-secondary hover:bg-surface-raised"
        aria-label={`通知${unread ? `（未読${unread}）` : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell className="h-4 w-4" />
        {unread > 0 ? (
          <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-accent" />
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 z-[40] mt-1 w-[min(100vw-1.5rem,20rem)] rounded-[12px] border border-border bg-surface shadow-[var(--shadow-menu)]">
          <div className="border-b border-border px-3 py-2 text-[13px] font-medium">通知</div>
          {notifications.length === 0 ? (
            <p className="px-3 py-3 text-[12px] text-text-secondary">新しい通知はありません</p>
          ) : (
            <ul>
              {notifications.map((n) => (
                <li key={n.id} className="border-b border-border px-3 py-2.5 last:border-0">
                  <p className={cn("text-[13px]", !n.read && "font-medium")}>{n.title}</p>
                  <p className="mt-0.5 text-[12px] text-text-secondary">{n.body}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ProfileMenu() {
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<{
    name: string;
    departmentLabel: string;
    mode: string;
  }>({ name: "利用者", departmentLabel: "", mode: "dev-sample" });
  const [loggingOut, setLoggingOut] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/auth/session");
        const json = (await res.json()) as {
          mode?: string;
          user?: { displayName?: string } | null;
          membership?: { departmentLabel?: string } | null;
        };
        if (cancelled) return;
        setProfile({
          name: json.user?.displayName || json.membership?.departmentLabel || "利用者",
          departmentLabel: json.membership?.departmentLabel ?? "",
          mode: json.mode ?? "dev-sample",
        });
      } catch {
        /* keep defaults */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    if (profile.mode === "dev-sample") return;
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.replace("/login");
      router.refresh();
    } finally {
      setLoggingOut(false);
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        className="inline-flex h-10 items-center gap-1.5 rounded-md px-1.5 text-text-secondary hover:bg-surface-raised"
        aria-label="プロフィールメニュー"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-surface-sunken">
          <User className="h-3.5 w-3.5" />
        </span>
        <span className="hidden text-[12px] md:inline">{profile.name}</span>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-[40] mt-1 w-52 rounded-[12px] border border-border bg-surface py-1 shadow-[var(--shadow-menu)]"
        >
          <div className="border-b border-border px-3 py-2">
            <p className="text-[13px] font-medium">{profile.name}</p>
            {profile.departmentLabel ? (
              <p className="text-[11px] text-text-secondary">{profile.departmentLabel}</p>
            ) : null}
          </div>
          <Link href="/workspace" className="block px-3 py-2 text-[13px] hover:bg-surface-raised md:hidden">
            ワークスペース
          </Link>
          <Link href="/settings" className="block px-3 py-2 text-[13px] hover:bg-surface-raised">
            設定
          </Link>
          <Link href="/admin" className="block px-3 py-2 text-[13px] hover:bg-surface-raised">
            管理センター
          </Link>
          {profile.mode === "dev-sample" ? (
            <button
              type="button"
              className="block w-full px-3 py-2 text-left text-[13px] text-text-secondary hover:bg-surface-raised"
              disabled
              title="サンプルモードではログアウトは不要です"
            >
              ログアウト
            </button>
          ) : (
            <button
              type="button"
              className="block w-full px-3 py-2 text-left text-[13px] hover:bg-surface-raised"
              onClick={() => void logout()}
              disabled={loggingOut}
            >
              {loggingOut ? "ログアウト中…" : "ログアウト"}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const inputId = useId();
  const ref = useRef<HTMLInputElement>(null);
  const commands = [
    { href: "/assistant", label: "新しいチャット" },
    { href: "/tasks?filter=today", label: "今日のタスク" },
    { href: "/workspace/research", label: "調査ライブラリ" },
    { href: "/workspace/documents", label: "ドキュメント" },
    { href: "/workspace/projects", label: "プロジェクトを開く" },
    { href: "/settings", label: "設定を開く" },
    { href: "/search", label: "横断検索" },
  ];

  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/30 p-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-labelledby={inputId}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-[12px] border border-border bg-surface shadow-[var(--shadow-modal)]"
        onClick={(e) => e.stopPropagation()}
      >
        <label htmlFor={inputId} className="sr-only">
          コマンドを検索
        </label>
        <input
          id={inputId}
          ref={ref}
          className="w-full border-b border-border bg-transparent px-4 py-3 text-[14px] outline-none"
          placeholder="コマンドまたは画面を検索…"
        />
        <ul className="max-h-72 overflow-y-auto py-1">
          {commands.map((c) => (
            <li key={c.href}>
              <Link
                href={c.href}
                className="block px-4 py-2.5 text-[13px] hover:bg-surface-raised"
                onClick={onClose}
              >
                {c.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
