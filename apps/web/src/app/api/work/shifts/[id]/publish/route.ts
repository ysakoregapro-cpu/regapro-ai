import { NextResponse } from "next/server";
import { publishShiftForAccess } from "@/lib/application/shift-service";
import { withPlatformGuard } from "@/lib/platform/api-guard";

type Context = { params: Promise<{ id: string }> };

export const POST = withPlatformGuard<Context>(
  { permission: "shift.manage" },
  async ({ access, context }) => {
    const { id } = await context.params;
    const shift = await publishShiftForAccess(access, id);
    return NextResponse.json({ ok: true, shift });
  },
);
