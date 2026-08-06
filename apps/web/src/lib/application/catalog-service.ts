import {
  CURRENT_USER,
  SAMPLE_ACTIVITY,
  SAMPLE_DOCUMENTS,
  SAMPLE_KNOWLEDGE,
  SAMPLE_MESSAGES,
  SAMPLE_NOTIFICATIONS,
  SAMPLE_PROJECTS,
  SAMPLE_PROMPTS,
  SAMPLE_RESEARCH,
  SAMPLE_TASKS,
  SAMPLE_THREADS,
  type SampleTask,
  projectName,
  userName,
} from "@/lib/data/dev-sample/catalog";
import { CURRENT_MEMBERSHIP } from "@/lib/data/dev-sample/memberships";
import { isDevSampleMode } from "@/lib/supabase/env";
import { searchAccessible } from "@/lib/application/chat-service";
import { resolveSessionAccess } from "@/lib/data/dev-sample/memberships";
import { filterResourcesByAccess } from "@regapro/security";
import type { ConfidentialityLevel, Visibility } from "@regapro/shared";

export type HomeDashboard = {
  greetingName: string;
  todayTasks: SampleTask[];
  dueSoonTasks: SampleTask[];
  needsAttention: { id: string; title: string; reason: string }[];
  continueWork: { id: string; title: string; href: string }[];
  recentThreads: typeof SAMPLE_THREADS;
  recentDocuments: typeof SAMPLE_DOCUMENTS;
  frequentProjects: typeof SAMPLE_PROJECTS;
  recentActivity: typeof SAMPLE_ACTIVITY;
};

function assertDevOrThrow() {
  // In supabase mode these services will be swapped to repository-backed ones.
  // For now, application entrypoints still gate on mode explicitly.
  void isDevSampleMode;
}

export function getHomeDashboard(): HomeDashboard {
  assertDevOrThrow();
  const today = SAMPLE_TASKS.filter(
    (t) => t.status !== "done" && t.status !== "cancelled" && t.dueAt.startsWith("2026-08-06")
  );
  const dueSoon = SAMPLE_TASKS.filter(
    (t) =>
      t.status !== "done" &&
      t.status !== "cancelled" &&
      (t.dueAt.startsWith("2026-08-07") || t.dueAt.startsWith("2026-08-08"))
  );
  return {
    greetingName: CURRENT_MEMBERSHIP.name,
    todayTasks: today.length ? today : SAMPLE_TASKS.filter((t) => t.status === "todo").slice(0, 2),
    dueSoonTasks: dueSoon,
    needsAttention: [
      {
        id: "attn-1",
        title: "代表確認が必要な採用条件案を整理",
        reason: "優先度：至急",
      },
      {
        id: "attn-2",
        title: "ナレッジ承認待ち",
        reason: "確認が必要",
      },
    ],
    continueWork: [
      {
        id: "cont-1",
        title: "求人選定の状況整理",
        href: "/assistant?thread=thread-1",
      },
      {
        id: "cont-2",
        title: "通信イベント運営資料の初稿レビュー",
        href: "/tasks?task=task-2",
      },
    ],
    recentThreads: SAMPLE_THREADS,
    recentDocuments: SAMPLE_DOCUMENTS,
    frequentProjects: SAMPLE_PROJECTS,
    recentActivity: SAMPLE_ACTIVITY,
  };
}

export function listTasks(filter: "today" | "upcoming" | "all" | "done" = "all") {
  const open = SAMPLE_TASKS.filter((t) => t.status !== "done" && t.status !== "cancelled");
  if (filter === "today") {
    return open.filter((t) => t.dueAt.startsWith("2026-08-06") || t.priority === "urgent");
  }
  if (filter === "upcoming") {
    return open.filter((t) => !t.dueAt.startsWith("2026-08-06"));
  }
  if (filter === "done") {
    return SAMPLE_TASKS.filter((t) => t.status === "done");
  }
  return SAMPLE_TASKS;
}

export function getTask(id: string) {
  return SAMPLE_TASKS.find((t) => t.id === id) ?? null;
}

export function listThreads() {
  return SAMPLE_THREADS;
}

export function getThreadMessages(threadId: string) {
  return SAMPLE_MESSAGES.filter((m) => m.threadId === threadId);
}

export function listKnowledge() {
  return SAMPLE_KNOWLEDGE;
}

export function listResearch() {
  return SAMPLE_RESEARCH;
}

export function listDocuments() {
  return SAMPLE_DOCUMENTS;
}

export function listPrompts() {
  return SAMPLE_PROMPTS;
}

export function listProjects() {
  return SAMPLE_PROJECTS;
}

export function listNotifications() {
  return SAMPLE_NOTIFICATIONS;
}

export type SearchHit = {
  id: string;
  kind: string;
  title: string;
  snippet: string;
  project: string;
  updatedAt: string;
  source: string;
};

export function searchAll(query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const base = resolveSessionAccess();
  const session = resolveSessionAccess({
    userId: base.membership.userId,
    threadLevel: base.maximumConfidentialityLevel,
    threadVisibility: "organization",
  });
  const hits: SearchHit[] = [];

  for (const t of SAMPLE_TASKS) {
    if (t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)) {
      hits.push({
        id: t.id,
        kind: "タスク",
        title: t.title,
        snippet: t.description,
        project: projectName(t.projectId),
        updatedAt: t.dueAt.slice(0, 10),
        source: "タスク",
      });
    }
  }

  const knowledgeRows = SAMPLE_KNOWLEDGE.map((k) => ({
    id: k.id,
    confidentialityLevel: k.confidentialityLevel as ConfidentialityLevel,
    visibility: k.visibility as Visibility,
    ownerUserId: "system",
    raw: k,
  }));
  for (const row of filterResourcesByAccess(session.access, knowledgeRows)) {
    const k = row.raw;
    if (k.title.toLowerCase().includes(q) || k.category.toLowerCase().includes(q)) {
      hits.push({
        id: k.id,
        kind: "ナレッジ",
        title: k.title,
        snippet: `${k.category} / ${k.business}`,
        project: projectName(k.projectId),
        updatedAt: k.updatedAt,
        source: "ナレッジ",
      });
    }
  }

  // Private chats of others are excluded inside searchAccessible
  for (const h of searchAccessible(q, session.membership.userId)) {
    hits.push({
      id: h.id,
      kind: h.kind,
      title: h.title,
      snippet: h.snippet,
      project: "—",
      updatedAt: "—",
      source: "アシスタント",
    });
  }

  for (const d of SAMPLE_DOCUMENTS) {
    if (d.title.toLowerCase().includes(q)) {
      hits.push({
        id: d.id,
        kind: "ドキュメント",
        title: d.title,
        snippet: d.kind,
        project: projectName(d.projectId),
        updatedAt: d.updatedAt,
        source: "ドキュメント",
      });
    }
  }
  for (const p of SAMPLE_PROMPTS) {
    if (p.title.toLowerCase().includes(q) || p.target.toLowerCase().includes(q)) {
      hits.push({
        id: p.id,
        kind: "プロンプト",
        title: p.title,
        snippet: `${p.target}向け`,
        project: projectName(p.projectId),
        updatedAt: p.updatedAt,
        source: "プロンプト",
      });
    }
  }
  for (const p of SAMPLE_PROJECTS) {
    if (p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)) {
      hits.push({
        id: p.id,
        kind: "プロジェクト",
        title: p.name,
        snippet: p.description,
        project: p.name,
        updatedAt: "—",
        source: "プロジェクト",
      });
    }
  }

  return hits;
}

export { userName, projectName, CURRENT_USER };
