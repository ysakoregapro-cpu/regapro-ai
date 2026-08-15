import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureAssistantReplyAsync } from "@/lib/application/data-gateway";
import { catchToJson } from "@/lib/application/api-errors";

type Params = { params: Promise<{ threadId: string }> };

const BodySchema = z.object({
  idempotencyKey: z.string().min(8).max(160).optional(),
});

export async function POST(request: Request, { params }: Params) {
  try {
    const { threadId } = await params;
    const json = await request.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(json);
    const idempotencyKey =
      (parsed.success ? parsed.data.idempotencyKey : undefined) ??
      request.headers.get("Idempotency-Key") ??
      undefined;

    const result = await ensureAssistantReplyAsync({ threadId, idempotencyKey });
    if (!result.ok) {
      return NextResponse.json(result, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      message: result.message,
      messages: result.messages,
      created: result.created,
    });
  } catch (err) {
    return catchToJson(err);
  }
}
