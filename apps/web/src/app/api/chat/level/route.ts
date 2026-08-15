import { NextResponse } from "next/server";
import { z } from "zod";
import { ConfidentialityLevelSchema } from "@regapro/shared";
import { changeThreadLevelAsync } from "@/lib/application/data-gateway";
import { catchToJson } from "@/lib/application/api-errors";

const BodySchema = z.object({
  threadId: z.string().min(1),
  newLevel: ConfidentialityLevelSchema,
});

export async function POST(request: Request) {
  try {
    const json = await request.json().catch(() => null);
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, message: "入力が不正です" }, { status: 400 });
    }
    const result = await changeThreadLevelAsync(parsed.data);
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch (err) {
    return catchToJson(err);
  }
}
