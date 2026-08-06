import { NextResponse } from "next/server";
import { listVisibleThreads } from "@/lib/application/chat-service";

export async function GET() {
  const threads = listVisibleThreads();
  return NextResponse.json({ ok: true, threads });
}
