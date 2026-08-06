import { NextResponse } from "next/server";
import { getThreadBundle } from "@/lib/application/chat-service";

type Params = { params: Promise<{ threadId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { threadId } = await params;
  const bundle = getThreadBundle(threadId);
  if (!bundle) {
    return NextResponse.json(
      { ok: false, message: "会話が見つかりません" },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, ...bundle });
}
