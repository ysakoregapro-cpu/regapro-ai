import { NextResponse } from "next/server";
import { WorkRecordReasonSchema } from "@regapro/work";
import { jsonError } from "@/lib/application/api-errors";
import { voidWorkRecordForAccess } from "@/lib/application/work-record-service";
import { withPlatformGuard } from "@/lib/platform/api-guard";

type Context = { params: Promise<{ id: string }> };

export const POST = withPlatformGuard<Context>(
  { anyPermissions: ["work_record.submit", "work_record.manage"] },
  async ({ request, access, context }) => {
    const parsed = WorkRecordReasonSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("VALIDATION");
    const { id } = await context.params;
    const record = await voidWorkRecordForAccess(access, id, parsed.data.reason);
    return NextResponse.json({ ok: true, record });
  },
);
