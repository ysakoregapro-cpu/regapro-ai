import { NextResponse } from "next/server";
import { CreateWorkLocationSchema } from "@regapro/work";
import { catchToJson, jsonError } from "@/lib/application/api-errors";
import {
  createWorkLocationForAccess,
  listWorkLocationsForAccess,
} from "@/lib/application/shift-service";
import { withPlatformGuard } from "@/lib/platform/api-guard";

export const GET = withPlatformGuard(
  { anyPermissions: ["shift.view_own", "shift.request", "shift.manage"] },
  async ({ access }) => {
    try {
      const locations = await listWorkLocationsForAccess(access);
      return NextResponse.json({ ok: true, locations });
    } catch (err) {
      return catchToJson(err);
    }
  },
);

export const POST = withPlatformGuard(
  { permission: "shift.manage" },
  async ({ request, access }) => {
    try {
      const parsed = CreateWorkLocationSchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return jsonError("VALIDATION");
      const location = await createWorkLocationForAccess(access, parsed.data);
      return NextResponse.json({ ok: true, location });
    } catch (err) {
      return catchToJson(err);
    }
  },
);
