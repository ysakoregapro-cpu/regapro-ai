import { NextResponse } from "next/server";
import { z } from "zod";
import { isDevSampleMode } from "@/lib/supabase/env";
import { listTasks as listSampleTasks } from "@/lib/application/catalog-service";
import { catchToJson, jsonError } from "@/lib/application/api-errors";
import { resolveAppSession } from "@/lib/application/session-access";
import { getSupabaseWorkUnitPersistence } from "@/lib/data/persistence";

export async function GET(request: Request) {
  try {
    const filter = new URL(request.url).searchParams.get("filter") ?? "all";

    if (isDevSampleMode()) {
      const tasks = listSampleTasks(
        filter as "today" | "upcoming" | "all" | "done",
      ).map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        projectId: t.projectId,
        dueAt: t.dueAt,
        originThreadId: null as string | null,
        confidentialityLevel: "company" as const,
        visibility: "private" as const,
        createdAt: t.dueAt,
        updatedAt: t.dueAt,
      }));
      return NextResponse.json({ ok: true, mode: "dev-sample", tasks });
    }

    await resolveAppSession();
    const persist = await getSupabaseWorkUnitPersistence();
    const tasks = await persist.tasks.listAccessible();
    const mapped = tasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description ?? "",
      status: t.status,
      priority: "medium",
      projectId: t.projectId,
      dueAt: t.updatedAt,
      originThreadId: t.originThreadId,
      confidentialityLevel: t.confidentialityLevel,
      visibility: t.visibility,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));
    return NextResponse.json({ ok: true, mode: "supabase", tasks: mapped });
  } catch (err) {
    return catchToJson(err);
  }
}

const CreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  originThreadId: z.string().uuid().optional(),
  originMessageId: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  try {
    if (isDevSampleMode()) {
      return jsonError("VALIDATION", 400, {
        message: "手動タスク作成は supabase mode で利用できます。",
      });
    }
    const parsed = CreateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("VALIDATION");

    const session = await resolveAppSession();
    const persist = await getSupabaseWorkUnitPersistence();
    const now = new Date().toISOString();
    let confidentialityLevel = session.maximumConfidentialityLevel;
    const visibility = "private" as const;
    let projectId: string | null = null;

    if (parsed.data.originThreadId) {
      const thread = await persist.chat.getThread(parsed.data.originThreadId);
      if (!thread) return jsonError("FORBIDDEN");
      confidentialityLevel = thread.confidentialityLevel;
      projectId = thread.projectId;
    }

    const task = await persist.tasks.create({
      id: globalThis.crypto.randomUUID(),
      orgId: session.membership.organizationId,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      status: "open",
      projectId,
      createdBy: session.membership.userId,
      confidentialityLevel,
      visibility,
      originThreadId: parsed.data.originThreadId ?? null,
      originMessageId: parsed.data.originMessageId ?? null,
      createdAt: now,
      updatedAt: now,
    });
    return NextResponse.json({ ok: true, task });
  } catch (err) {
    return catchToJson(err);
  }
}
