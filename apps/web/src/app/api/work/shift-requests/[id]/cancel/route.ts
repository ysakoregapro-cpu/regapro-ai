import { NextResponse } from "next/server";
import { cancelShiftRequestForAccess } from "@/lib/application/shift-service";
import { withPlatformGuard } from "@/lib/platform/api-guard";

type Context = { params: Promise<{ id: string }> };

export const POST = withPlatformGuard<Context>(
  { anyPermissions: ["shift.request", "shift.manage"] },
  async ({ access, context }) => {
    const { id } = await context.params;
    const request = await cancelShiftRequestForAccess(access, id);
    return NextResponse.json({ ok: true, request });
  },
);
