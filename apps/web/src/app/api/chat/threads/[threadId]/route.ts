import { NextResponse } from "next/server";
import { getThreadBundleAsync } from "@/lib/application/data-gateway";
import { catchToJson, jsonError } from "@/lib/application/api-errors";

type Params = { params: Promise<{ threadId: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { threadId } = await params;
    const bundle = await getThreadBundleAsync(threadId);
    if (!bundle) {
      return jsonError("NOT_FOUND");
    }
    return NextResponse.json({ ok: true, ...bundle });
  } catch (err) {
    return catchToJson(err);
  }
}
