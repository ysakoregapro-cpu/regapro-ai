import { NextResponse } from "next/server";
import { z } from "zod";
import { isDevSampleMode } from "@/lib/supabase/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  loadLiveMembership,
  type RegaproSupabaseClient,
} from "@/lib/supabase/membership";
import { decideLoginAdmission } from "@/lib/supabase/session-admission";
import {
  loadStaffRecord,
  type PlatformQueryClient,
} from "@/lib/platform/staff-queries";

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

  const client = supabase as unknown as RegaproSupabaseClient;
  const membership = await loadLiveMembership(client, data.user.id);
  const staff = await loadStaffRecord(
    supabase as unknown as PlatformQueryClient,
    data.user.id,
  );
  const admission = decideLoginAdmission({ membership, staff });

  if (!admission.ok) {
    await supabase.auth.signOut();
    return NextResponse.json(
      { error: admission.message, code: admission.code },
      { status: 403 },
    );
  }

  const organizationId =
    admission.kind === "legacy_membership"
      ? admission.membership.organizationId
      : admission.staff.organizationId;

  const nextPath =
    parsed.data.next && parsed.data.next.startsWith("/")
      ? parsed.data.next
      : "/home";

  if (contentType.includes("application/json")) {
    return NextResponse.json({
      ok: true,
      userId: data.user.id,
      organizationId,
      sessionKind: admission.kind,
      next: nextPath,
    });
  }

  return NextResponse.redirect(new URL(nextPath, request.url), { status: 303 });
}
