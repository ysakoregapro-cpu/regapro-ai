import { NextResponse } from "next/server";
import { confirmWorkRecordForAccess } from "@/lib/application/work-record-service";
import { withPlatformGuard } from "@/lib/platform/api-guard";

type Context = { params: Promise<{ id: string }> };

export const POST = withPlatformGuard<Context>(
  { anyPermissions: ["work_record.submit", "work_record.manage"] },
  async ({ access, context }) => {
    const { id } = await context.params;
    const record = await confirmWorkRecordForAccess(access, id);
    return NextResponse.json({ ok: true, record });
  },
);
