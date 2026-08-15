import { NextResponse } from "next/server";
import { isDevSampleMode } from "@/lib/supabase/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  if (isDevSampleMode()) {
    return NextResponse.json(
      { error: "Auth API is unavailable in dev-sample mode." },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();

  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("application/json")) {
    return NextResponse.json({ ok: true });
  }

  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
