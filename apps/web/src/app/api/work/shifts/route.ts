import { NextResponse } from "next/server";
import {
  CreateShiftSchema,
  ShiftListQuerySchema,
} from "@regapro/work";
import { jsonError } from "@/lib/application/api-errors";
import {
  createDraftShiftForAccess,
  listShiftsForAccess,
} from "@/lib/application/shift-service";
import { withPlatformGuard } from "@/lib/platform/api-guard";

export const GET = withPlatformGuard(
  { anyPermissions: ["shift.view_own", "shift.manage"] },
  async ({ request, access }) => {
    const url = new URL(request.url);
    const parsed = ShiftListQuerySchema.safeParse({
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      staffId: url.searchParams.get("staffId") ?? undefined,
    });
    if (!parsed.success) return jsonError("VALIDATION");
    const shifts = await listShiftsForAccess(access, parsed.data);
    return NextResponse.json({ ok: true, shifts });
  },
);

export const POST = withPlatformGuard(
  { permission: "shift.manage" },
  async ({ request, access }) => {
    const parsed = CreateShiftSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("VALIDATION");
    const shift = await createDraftShiftForAccess(access, parsed.data);
    return NextResponse.json({ ok: true, shift });
  },
);
