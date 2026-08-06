import { NextResponse } from "next/server";
import { z } from "zod";
import { createDerivedResource } from "@/lib/application/chat-service";

const BodySchema = z.object({
  threadId: z.string().min(1),
  messageId: z.string().optional(),
  kind: z.enum([
    "task",
    "artifact",
    "research",
    "prompt",
    "knowledge_candidate",
  ]),
  title: z.string().min(1),
});

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "入力が不正です" }, { status: 400 });
  }
  try {
    const resource = createDerivedResource(parsed.data);
    return NextResponse.json({ ok: true, resource });
  } catch {
    return NextResponse.json(
      { ok: false, message: "作成できませんでした" },
      { status: 404 },
    );
  }
}
