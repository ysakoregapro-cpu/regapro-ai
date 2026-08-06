import { NextResponse } from "next/server";
import { z } from "zod";
import {
  appendUserMessage,
  ensureAssistantReply,
} from "@/lib/application/chat-service";

type Params = { params: Promise<{ threadId: string }> };

const BodySchema = z.object({
  content: z.string(),
});

export async function POST(request: Request, { params }: Params) {
  const { threadId } = await params;
  const json = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: "入力が不正です" },
      { status: 400 },
    );
  }

  const appended = appendUserMessage({
    threadId,
    content: parsed.data.content,
  });
  if (!appended.ok) {
    return NextResponse.json(appended, { status: 400 });
  }

  const replied = ensureAssistantReply({ threadId });
  if (!replied.ok) {
    return NextResponse.json(
      { ok: true, messages: appended.messages, replyError: replied.message },
      { status: 200 },
    );
  }

  return NextResponse.json({
    ok: true,
    messages: replied.messages,
    userMessage: appended.message,
    assistantMessage: replied.message,
    created: replied.created,
  });
}
