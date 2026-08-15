import { NextResponse } from "next/server";
import { z } from "zod";
import { createDerivedResourceAsync } from "@/lib/application/data-gateway";
import { catchToJson } from "@/lib/application/api-errors";

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
  try {
    const json = await request.json().catch(() => null);
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, message: "入力が不正です" }, { status: 400 });
    }
    const resource = await createDerivedResourceAsync(parsed.data);
    return NextResponse.json({ ok: true, resource });
  } catch (err) {
    return catchToJson(err);
  }
}
