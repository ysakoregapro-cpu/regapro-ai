import { NextResponse } from "next/server";
import {
  CreateWorkRecordDraftSchema,
  WorkRecordListQuerySchema,
} from "@regapro/work";
import { jsonError } from "@/lib/application/api-errors";
import {
  createOrUpdateWorkRecordDraftForAccess,
  listWorkRecordsForAccess,
} from "@/lib/application/work-record-service";
import { withPlatformGuard } from "@/lib/platform/api-guard";

export const GET = withPlatformGuard(
  { anyPermissions: ["work_record.view_own", "work_record.submit", "work_record.manage"] },
  async ({ request, access }) => {
    const url = new URL(request.url);
    const parsed = WorkRecordListQuerySchema.safeParse({
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      staffId: url.searchParams.get("staffId") ?? undefined,
    });
    if (!parsed.success) return jsonError("VALIDATION");
    const records = await listWorkRecordsForAccess(access, parsed.data);
    return NextResponse.json({ ok: true, records });
  },
);

export const POST = withPlatformGuard(
  { anyPermissions: ["work_record.submit", "work_record.manage"] },
  async ({ request, access }) => {
    const parsed = CreateWorkRecordDraftSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("VALIDATION");
    const record = await createOrUpdateWorkRecordDraftForAccess(access, parsed.data);
    return NextResponse.json({ ok: true, record });
  },
);
