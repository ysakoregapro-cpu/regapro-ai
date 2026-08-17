import { NextResponse } from "next/server";
import { z } from "zod";
import { ConfidentialityLevelSchema } from "@regapro/shared";
import { startChatFromHomeAsync } from "@/lib/application/data-gateway";
import { catchToJson } from "@/lib/application/api-errors";
import { lastSafeRuntimeSnapshot } from "@/lib/application/runtime-snapshot";

const BodySchema = z.object({
  content: z.string(),
  requestedLevel: ConfidentialityLevelSchema.default("company"),
  confirmRaise: z.boolean().optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export async function POST(request: Request) {
  try {
    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json(
        { ok: false, code: "EMPTY", message: "不正なリクエストです", restoreContent: "" },
        { status: 400 },
      );
    }

    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          code: "EMPTY",
          message: "入力内容を確認してください",
          restoreContent:
            typeof (json as { content?: string })?.content === "string"
              ? (json as { content: string }).content
              : "",
        },
        { status: 400 },
      );
    }

    const idempotencyKey =
      parsed.data.idempotencyKey ??
      request.headers.get("Idempotency-Key") ??
      undefined;

    // Membership / clearance resolved server-side — never trust client org/dept/level alone.
    const result = await startChatFromHomeAsync({
      content: parsed.data.content,
      requestedLevel: parsed.data.requestedLevel,
      confirmRaise: parsed.data.confirmRaise,
      idempotencyKey,
    });

    const status =
      result.ok ? 200 : result.code === "NEEDS_CONFIRMATION" ? 409 : 400;

    return NextResponse.json(
      { ...result, runtime: lastSafeRuntimeSnapshot() },
      { status },
    );
  } catch (err) {
    return catchToJson(err);
  }
}
