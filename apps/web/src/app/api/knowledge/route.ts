import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { resolveAppSession } from "@/lib/application/session-access";
import { isDevSampleMode } from "@/lib/supabase/env";
import {
  createManualKnowledgeDraft,
  listManagedKnowledge,
  transitionManualKnowledge,
} from "@/lib/application/knowledge-ingest-service";
import type { KnowledgeLifecycleState } from "@regapro/knowledge";
import { ConfidentialityLevelSchema, VisibilitySchema } from "@regapro/shared";

export const runtime = "nodejs";

const CreateSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(100_000),
  confidentialityLevel: ConfidentialityLevelSchema.default("company"),
  visibility: VisibilitySchema.default("organization"),
  departmentId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
});

const TransitionSchema = z.object({
  documentId: z.string().uuid(),
  from: z.enum([
    "draft",
    "review",
    "approved",
    "published",
    "superseded",
    "expired",
    "archived",
  ]),
  to: z.enum([
    "draft",
    "review",
    "approved",
    "published",
    "superseded",
    "expired",
    "archived",
  ]),
  reason: z.string().max(500).optional(),
});

export async function GET() {
  if (isDevSampleMode()) {
    return NextResponse.json({
      mode: "dev-sample",
      documents: [],
      notice: "supabase mode で実ナレッジを管理できます。",
    });
  }
  const session = await resolveAppSession({});
  const client = await createServerSupabaseClient();
  const documents = await listManagedKnowledge(
    client,
    session.access.organizationId,
  );
  return NextResponse.json({ mode: "supabase", documents });
}

export async function POST(req: Request) {
  if (isDevSampleMode()) {
    return NextResponse.json(
      { error: "Knowledge write requires supabase mode" },
      { status: 400 },
    );
  }
  const session = await resolveAppSession({});
  const client = await createServerSupabaseClient();
  const json = await req.json();
  const action = typeof json?.action === "string" ? json.action : "create";

  if (action === "transition") {
    const parsed = TransitionSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    await transitionManualKnowledge(client, {
      documentId: parsed.data.documentId,
      from: parsed.data.from as KnowledgeLifecycleState,
      to: parsed.data.to as KnowledgeLifecycleState,
      userId: session.access.userId,
      reason: parsed.data.reason,
    });
    return NextResponse.json({ ok: true });
  }

  const parsed = CreateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const created = await createManualKnowledgeDraft(client, {
    orgId: session.access.organizationId,
    userId: session.access.userId,
    title: parsed.data.title,
    body: parsed.data.body,
    confidentialityLevel: parsed.data.confidentialityLevel,
    visibility: parsed.data.visibility,
    departmentId: parsed.data.departmentId,
    projectId: parsed.data.projectId,
  });
  return NextResponse.json({ ok: true, ...created });
}
