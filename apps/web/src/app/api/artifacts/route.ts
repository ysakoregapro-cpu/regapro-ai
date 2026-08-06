import { NextResponse } from "next/server";
import { z } from "zod";
import {
  listArtifactsForThread,
  listDocumentLibrary,
  reviseArtifact,
} from "@/lib/application/artifact-service";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const threadId = searchParams.get("threadId");
  if (threadId) {
    return NextResponse.json({
      ok: true,
      artifacts: listArtifactsForThread(threadId),
    });
  }
  return NextResponse.json({
    ok: true,
    artifacts: listDocumentLibrary(),
  });
}

const ReviseSchema = z.object({
  artifactId: z.string(),
  instruction: z.string().min(1),
});

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = ReviseSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "不正な入力です" }, { status: 400 });
  }
  const art = reviseArtifact(parsed.data);
  if (!art) {
    return NextResponse.json({ ok: false, message: "成果物が見つかりません" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, artifact: art });
}
