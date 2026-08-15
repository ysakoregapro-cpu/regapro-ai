import "server-only";
import { isDevSampleMode } from "@/lib/supabase/env";
import {
  getHomeDashboard,
  type HomeDashboard,
  type SampleTask,
} from "@/lib/application/catalog-service";
import { resolveAppSession } from "@/lib/application/session-access";
import { getSupabaseWorkUnitPersistence } from "@/lib/data/persistence";

/** Server-only home dashboard (live Supabase or sample). */
export async function getHomeDashboardAsync(): Promise<HomeDashboard> {
  if (isDevSampleMode()) return getHomeDashboard();

  const session = await resolveAppSession();
  const persist = await getSupabaseWorkUnitPersistence();
  const [threads, tasks, artifacts] = await Promise.all([
    persist.chat.listThreads(),
    persist.tasks.listAccessible(),
    persist.artifacts.listLibrary(),
  ]);

  const openTasks = tasks.filter(
    (t) => t.status !== "completed" && t.status !== "cancelled",
  );
  const mappedTasks: SampleTask[] = openTasks.slice(0, 8).map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description ?? "",
    status: t.status === "open" ? "todo" : "in_progress",
    priority: "normal" as const,
    assigneeId: t.createdBy,
    projectId: t.projectId ?? "",
    dueAt: t.updatedAt,
    notifyDayBefore: false,
    createdFrom: t.originThreadId ? "会話" : "手動",
    relatedPeople: [],
  }));

  return {
    greetingName: session.membership.name,
    todayTasks: mappedTasks.slice(0, 3),
    dueSoonTasks: mappedTasks.slice(3, 6),
    needsAttention: [],
    continueWork: threads.slice(0, 3).map((th) => ({
      id: th.id,
      title: th.title,
      href: `/assistant?thread=${th.id}`,
    })),
    recentThreads: threads.slice(0, 6).map((th) => ({
      id: th.id,
      title: th.title,
      preview: "",
    })),
    recentDocuments: artifacts.slice(0, 6).map((a) => ({
      id: a.id,
      title: a.title,
      kind: a.format,
    })),
    frequentProjects: [],
    recentActivity: [],
    mode: "supabase",
  };
}
