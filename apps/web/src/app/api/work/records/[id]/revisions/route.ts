import { NextResponse } from "next/server";
import { catchToJson } from "@/lib/application/api-errors";
import { listWorkRecordRevisionsForAccess } from "@/lib/application/work-record-service";
import { withPlatformGuard } from "@/lib/platform/api-guard";

type Context = { params: Promise<{ id: string }> };

export const GET = withPlatformGuard<Context>(
  {
    anyPermissions: [
      "work_record.view_own",
      "work_record.submit",
      "work_record.manage",
    ],
  },
  async ({ access, context }) => {
    try {
      const { id } = await context.params;
      const revisions = await listWorkRecordRevisionsForAccess(access, id);
      return NextResponse.json({ ok: true, revisions });
    } catch (err) {
      return catchToJson(err);
    }
  },
);
