import { NextResponse } from "next/server";
import { z } from "zod";
import {
  appendUserMessage,
  ensureAssistantReply,
} from "@/lib/application/chat-service";
import { processWorkflowAfterUserMessage } from "@/lib/application/conversation-workflow";
import {
  listArtifactsForThread,
  reviseArtifact,
} from "@/lib/application/artifact-service";

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

  if (/修正|直して|追記|Version/.test(parsed.data.content)) {
    const arts = listArtifactsForThread(threadId);
    const latest = arts[arts.length - 1];
    if (latest) {
      reviseArtifact({
        artifactId: latest.id,
        instruction: parsed.data.content,
      });
    }
  }

  const workflow = processWorkflowAfterUserMessage({
    threadId,
    messageId: appended.message.id,
    content: parsed.data.content,
  });

  const replied = ensureAssistantReply({ threadId });
  if (!replied.ok) {
    return NextResponse.json(
      {
        ok: true,
        messages: appended.messages,
        replyError: replied.message,
        researchRunId: workflow.researchRunId,
        artifactId: workflow.artifactId,
      },
      { status: 200 },
    );
  }

  return NextResponse.json({
    ok: true,
    messages: replied.messages,
    userMessage: appended.message,
    assistantMessage: replied.message,
    created: replied.created,
    researchRunId: workflow.researchRunId,
    artifactId: workflow.artifactId,
  });
}
