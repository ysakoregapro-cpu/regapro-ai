import { NextResponse } from "next/server";
import {
  CreateShiftRequestDraftSchema,
  ShiftRequestListQuerySchema,
} from "@regapro/work";
import { jsonError } from "@/lib/application/api-errors";
import {
  createShiftRequestDraftForAccess,
  listShiftRequestsForAccess,
} from "@/lib/application/shift-service";
import { withPlatformGuard } from "@/lib/platform/api-guard";

export const GET = withPlatformGuard(
  { anyPermissions: ["shift.request", "shift.manage"] },
  async ({ request, access }) => {
    const url = new URL(request.url);
    const parsed = ShiftRequestListQuerySchema.safeParse({
      periodStart: url.searchParams.get("periodStart") ?? undefined,
      periodEnd: url.searchParams.get("periodEnd") ?? undefined,
      staffId: url.searchParams.get("staffId") ?? undefined,
    });
    if (!parsed.success) return jsonError("VALIDATION");
    const requests = await listShiftRequestsForAccess(access, parsed.data);
    return NextResponse.json({ ok: true, requests });
  },
);

export const POST = withPlatformGuard(
  { anyPermissions: ["shift.request", "shift.manage"] },
  async ({ request, access }) => {
    const parsed = CreateShiftRequestDraftSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) return jsonError("VALIDATION");
    const shiftRequest = await createShiftRequestDraftForAccess(access, parsed.data);
    return NextResponse.json({ ok: true, request: shiftRequest });
  },
);
