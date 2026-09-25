import { NextResponse } from "next/server";
import { listWorkLocationsForAccess } from "@/lib/application/shift-service";
import { withPlatformGuard } from "@/lib/platform/api-guard";

export const GET = withPlatformGuard(
  { anyPermissions: ["shift.view_own", "shift.request", "shift.manage"] },
  async ({ access }) => {
    const locations = await listWorkLocationsForAccess(access);
    return NextResponse.json({ ok: true, locations });
  },
);
