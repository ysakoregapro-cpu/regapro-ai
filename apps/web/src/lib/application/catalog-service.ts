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
  projectName as sampleProjectName,
  userName as sampleUserName,
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
  recentThreads: { id: string; title: string; preview: string }[];
  recentDocuments: { id: string; title: string; kind: string }[];
  frequentProjects: { id: string; name: string; description: string }[];
  recentActivity: { id: string; label: string; at: string }[];
  mode: "dev-sample" | "supabase";
};

function emptyHome(greetingName: string): HomeDashboard {
  return {
    greetingName,
    todayTasks: [],
    dueSoonTasks: [],
    needsAttention: [],
    continueWork: [],
    recentThreads: [],
    recentDocuments: [],
    frequentProjects: [],
    recentActivity: [],
    mode: "supabase",
  };
}

/**
 * Sync catalog for client components.
 * In supabase mode returns empty collections (never fixture IDs).
 */
export function getHomeDashboard(): HomeDashboard {
  if (!isDevSampleMode()) {
    return emptyHome("利用者");
  }
  const today = SAMPLE_TASKS.filter(
    (t) => t.status !== "done" && t.status !== "cancelled" && t.dueAt.startsWith("2026-08-06"),
  );
  const dueSoon = SAMPLE_TASKS.filter(
    (t) =>
      t.status !== "done" &&
      t.status !== "cancelled" &&
      (t.dueAt.startsWith("2026-08-07") || t.dueAt.startsWith("2026-08-08")),
  );
  return {
    greetingName: CURRENT_MEMBERSHIP.name,
    todayTasks: today.length ? today : SAMPLE_TASKS.filter((t) => t.status === "todo").slice(0, 2),
    dueSoonTasks: dueSoon,
    needsAttention: [
      { id: "attn-1", title: "代表確認が必要な採用条件案を整理", reason: "優先度：至急" },
      { id: "attn-2", title: "ナレッジ承認待ち", reason: "確認が必要" },
    ],
    continueWork: [
      { id: "cont-1", title: "求人選定の状況整理", href: "/assistant?thread=thread-1" },
      { id: "cont-2", title: "通信イベント運営資料の初稿レビュー", href: "/tasks?task=task-2" },
    ],
    recentThreads: SAMPLE_THREADS.map((th) => ({
      id: th.id,
      title: th.title,
      preview: th.preview,
    })),
    recentDocuments: SAMPLE_DOCUMENTS.map((d) => ({
      id: d.id,
      title: d.title,
      kind: d.kind,
    })),
    frequentProjects: SAMPLE_PROJECTS.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
    })),
    recentActivity: SAMPLE_ACTIVITY.map((a) => ({
      id: a.id,
      label: a.label,
      at: a.at,
    })),
    mode: "dev-sample",
  };
}

export function listTasks(filter: "today" | "upcoming" | "all" | "done" = "all") {
  if (!isDevSampleMode()) return [];
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
  if (!isDevSampleMode()) return null;
  return SAMPLE_TASKS.find((t) => t.id === id) ?? null;
}

export function listThreads() {
  if (!isDevSampleMode()) return [];
  return SAMPLE_THREADS;
}

export function getThreadMessages(threadId: string) {
  if (!isDevSampleMode()) return [];
  return SAMPLE_MESSAGES.filter((m) => m.threadId === threadId);
}

export function listKnowledge() {
  if (!isDevSampleMode()) return [];
  return SAMPLE_KNOWLEDGE;
}

export function listResearch() {
  if (!isDevSampleMode()) return [];
  return SAMPLE_RESEARCH;
}

export function listDocuments() {
  if (!isDevSampleMode()) return [];
  return SAMPLE_DOCUMENTS;
}

export function listPrompts() {
  if (!isDevSampleMode()) return [];
  return SAMPLE_PROMPTS;
}

export function listProjects() {
  if (!isDevSampleMode()) return [];
  return SAMPLE_PROJECTS;
}

export function listNotifications() {
  if (!isDevSampleMode()) return [];
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
  if (!isDevSampleMode()) return [];
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
        project: sampleProjectName(t.projectId),
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
        project: sampleProjectName(k.projectId),
        updatedAt: k.updatedAt,
        source: "ナレッジ",
      });
    }
  }

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
        project: sampleProjectName(d.projectId),
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
        project: sampleProjectName(p.projectId),
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

export function userName(id: string) {
  if (!isDevSampleMode()) return "担当者";
  return sampleUserName(id);
}

export function projectName(id: string) {
  if (!isDevSampleMode()) return id ? "プロジェクト" : "—";
  return sampleProjectName(id);
}

export { CURRENT_USER };
export type { SampleTask };
