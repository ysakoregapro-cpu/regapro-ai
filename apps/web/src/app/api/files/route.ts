import { NextResponse } from "next/server";
import { z } from "zod";
import {
  attachFileToThread,
} from "@/lib/application/conversation-workflow";
import { startConversationWorkflow } from "@/lib/application/conversation-workflow";
import { listFilesForThread, validateFileUpload } from "@/lib/application/file-object-service";

const BodySchema = z.object({
  threadId: z.string().optional(),
  name: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  createThread: z.boolean().optional(),
});

export async function GET(request: Request) {
  const threadId = new URL(request.url).searchParams.get("threadId");
  if (!threadId) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    files: listFilesForThread(threadId),
  });
}

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "不正な入力です" }, { status: 400 });
  }

  const check = validateFileUpload({
    mimeType: parsed.data.mimeType,
    sizeBytes: parsed.data.sizeBytes,
  });
  if (!check.ok) {
    return NextResponse.json(check, { status: 400 });
  }

  let threadId = parsed.data.threadId;
  let redirectTo: string | null = null;

  if (!threadId || parsed.data.createThread) {
    const started = startConversationWorkflow({
      workflowType: "file_review",
      initialMessage: undefined,
      idempotencyKey: globalThis.crypto.randomUUID(),
    });
    if (!started.ok) {
      return NextResponse.json(started, { status: 400 });
    }
    threadId = started.threadId;
    redirectTo = started.redirectTo;
  }

  const file = attachFileToThread({
    threadId,
    name: parsed.data.name,
    mimeType: parsed.data.mimeType,
    sizeBytes: parsed.data.sizeBytes,
  });
  if ("ok" in file && file.ok === false) {
    return NextResponse.json(file, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    file,
    threadId,
    redirectTo,
  });
}
