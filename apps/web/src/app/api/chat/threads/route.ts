import { NextResponse } from "next/server";
import { listVisibleThreadsAsync } from "@/lib/application/data-gateway";
import { catchToJson } from "@/lib/application/api-errors";

export async function GET() {
  try {
    const threads = await listVisibleThreadsAsync();
    return NextResponse.json({ ok: true, threads });
  } catch (err) {
    return catchToJson(err);
  }
}
