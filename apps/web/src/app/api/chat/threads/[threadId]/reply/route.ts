import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureAssistantReply } from "@/lib/application/chat-service";

type Params = { params: Promise<{ threadId: string }> };

const BodySchema = z.object({
  idempotencyKey: z.string().min(8).max(160).optional(),
});

export async function POST(request: Request, { params }: Params) {
  const { threadId } = await params;
  const json = await request.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(json);
  const idempotencyKey =
    (parsed.success ? parsed.data.idempotencyKey : undefined) ??
    request.headers.get("Idempotency-Key") ??
    undefined;

  const result = ensureAssistantReply({ threadId, idempotencyKey });
  if (!result.ok) {
    return NextResponse.json(result, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    message: result.message,
    messages: result.messages,
    created: result.created,
  });
}
