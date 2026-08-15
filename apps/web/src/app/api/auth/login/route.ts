import { NextResponse } from "next/server";
import { z } from "zod";
import { isDevSampleMode } from "@/lib/supabase/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  loadLiveMembership,
  type RegaproSupabaseClient,
} from "@/lib/supabase/membership";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  next: z.string().optional(),
});

export async function POST(request: Request) {
  if (isDevSampleMode()) {
    return NextResponse.json(
      { error: "Auth API is unavailable in dev-sample mode." },
      { status: 400 },
    );
  }

  const contentType = request.headers.get("content-type") ?? "";
  let raw: unknown;
  if (contentType.includes("application/json")) {
    raw = await request.json();
  } else {
    const form = await request.formData();
    raw = {
      email: form.get("email"),
      password: form.get("password"),
      next: form.get("next") || undefined,
    };
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "入力内容を確認してください。" }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error || !data.user) {
    return NextResponse.json(
      { error: "メールまたはパスワードが正しくありません。" },
      { status: 401 },
    );
  }

  const membership = await loadLiveMembership(
    supabase as unknown as RegaproSupabaseClient,
    data.user.id,
  );
  if (!membership) {
    await supabase.auth.signOut();
    return NextResponse.json(
      {
        error:
          "組織メンバーシップがありません。管理者に招待を依頼してください。",
      },
      { status: 403 },
    );
  }

  const nextPath =
    parsed.data.next && parsed.data.next.startsWith("/")
      ? parsed.data.next
      : "/home";

  if (contentType.includes("application/json")) {
    return NextResponse.json({
      ok: true,
      userId: data.user.id,
      organizationId: membership.organizationId,
      next: nextPath,
    });
  }

  return NextResponse.redirect(new URL(nextPath, request.url), { status: 303 });
}
