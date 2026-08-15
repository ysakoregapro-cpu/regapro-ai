import { NextResponse } from "next/server";
import { z } from "zod";
import {
  listArtifactsForThreadAsync,
  listDocumentLibraryAsync,
  reviseArtifactAsync,
} from "@/lib/application/data-gateway";
import { catchToJson, jsonError } from "@/lib/application/api-errors";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const threadId = searchParams.get("threadId");
    if (threadId) {
      return NextResponse.json({
        ok: true,
        artifacts: await listArtifactsForThreadAsync(threadId),
      });
    }
    return NextResponse.json({
      ok: true,
      artifacts: await listDocumentLibraryAsync(),
    });
  } catch (err) {
    return catchToJson(err);
  }
}

const ReviseSchema = z.object({
  artifactId: z.string(),
  instruction: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const json = await request.json().catch(() => null);
    const parsed = ReviseSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, message: "不正な入力です" }, { status: 400 });
    }
    const art = await reviseArtifactAsync(parsed.data);
    if (!art) {
      return jsonError("NOT_FOUND");
    }
    return NextResponse.json({ ok: true, artifact: art });
  } catch (err) {
    return catchToJson(err);
  }
}
