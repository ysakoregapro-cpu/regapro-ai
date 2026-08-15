import { NextResponse } from "next/server";
import { z } from "zod";
import {
  attachFileToThreadAsync,
  listFilesForThreadAsync,
  startConversationWorkflowAsync,
} from "@/lib/application/data-gateway";
import { validateFileUpload } from "@/lib/application/file-object-service";
import { catchToJson, jsonError } from "@/lib/application/api-errors";

const JsonBodySchema = z.object({
  threadId: z.string().optional(),
  name: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  createThread: z.boolean().optional(),
  /** base64 body required for durable / supabase uploads */
  contentBase64: z.string().min(1),
  idempotencyKey: z.string().uuid().optional(),
});

export async function GET(request: Request) {
  try {
    const threadId = new URL(request.url).searchParams.get("threadId");
    if (!threadId) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    return NextResponse.json({
      ok: true,
      files: await listFilesForThreadAsync(threadId),
    });
  } catch (err) {
    return catchToJson(err);
  }
}

async function resolveThread(input: {
  threadId?: string;
  createThread?: boolean;
}): Promise<
  | { ok: true; threadId: string; redirectTo: string | null }
  | { ok: false; response: NextResponse }
> {
  let threadId = input.threadId;
  let redirectTo: string | null = null;
  if (!threadId || input.createThread) {
    const started = await startConversationWorkflowAsync({
      workflowType: "file_review",
      initialMessage: undefined,
      idempotencyKey: globalThis.crypto.randomUUID(),
    });
    if (!started.ok) {
      return {
        ok: false,
        response: NextResponse.json(started, { status: 400 }),
      };
    }
    threadId = started.threadId;
    redirectTo = started.redirectTo;
  }
  return { ok: true, threadId, redirectTo };
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return jsonError("VALIDATION", 400);
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const check = validateFileUpload({
        mimeType: file.type || "application/octet-stream",
        sizeBytes: bytes.byteLength,
      });
      if (!check.ok) {
        return NextResponse.json(check, { status: 400 });
      }

      const threadIdRaw = form.get("threadId");
      const createThread = form.get("createThread") === "true";
      const idempotencyKey =
        typeof form.get("idempotencyKey") === "string"
          ? String(form.get("idempotencyKey"))
          : undefined;

      const resolved = await resolveThread({
        threadId: typeof threadIdRaw === "string" ? threadIdRaw : undefined,
        createThread,
      });
      if (!resolved.ok) return resolved.response;

      const result = await attachFileToThreadAsync({
        threadId: resolved.threadId,
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: bytes.byteLength,
        content: bytes,
        idempotencyKey,
      });
      if ("ok" in result && result.ok === false) {
        return NextResponse.json(result, { status: 400 });
      }
      return NextResponse.json({
        ok: true,
        file: result,
        threadId: resolved.threadId,
        redirectTo: resolved.redirectTo,
      });
    }

    const json = await request.json().catch(() => null);
    const parsed = JsonBodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "ファイル本体（contentBase64 または multipart file）が必要です",
        },
        { status: 400 },
      );
    }

    const check = validateFileUpload({
      mimeType: parsed.data.mimeType,
      sizeBytes: parsed.data.sizeBytes,
    });
    if (!check.ok) {
      return NextResponse.json(check, { status: 400 });
    }

    const bytes = Uint8Array.from(
      Buffer.from(parsed.data.contentBase64, "base64"),
    );

    const resolved = await resolveThread({
      threadId: parsed.data.threadId,
      createThread: parsed.data.createThread,
    });
    if (!resolved.ok) return resolved.response;

    const result = await attachFileToThreadAsync({
      threadId: resolved.threadId,
      name: parsed.data.name,
      mimeType: parsed.data.mimeType,
      sizeBytes: bytes.byteLength,
      content: bytes,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    if ("ok" in result && result.ok === false) {
      return NextResponse.json(result, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      file: result,
      threadId: resolved.threadId,
      redirectTo: resolved.redirectTo,
    });
  } catch (err) {
    return catchToJson(err);
  }
}
