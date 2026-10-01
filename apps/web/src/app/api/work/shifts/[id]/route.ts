import { NextResponse } from "next/server";
import { UpdateShiftDraftSchema } from "@regapro/work";
import { catchToJson, jsonError } from "@/lib/application/api-errors";
import { updateDraftShiftForAccess } from "@/lib/application/shift-service";
import { withPlatformGuard } from "@/lib/platform/api-guard";

type Context = { params: Promise<{ id: string }> };

export const PATCH = withPlatformGuard<Context>(
  { permission: "shift.manage" },
  async ({ request, access, context }) => {
    try {
      const { id } = await context.params;
      const parsed = UpdateShiftDraftSchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return jsonError("VALIDATION");
      const shift = await updateDraftShiftForAccess(access, id, parsed.data);
      return NextResponse.json({ ok: true, shift });
    } catch (err) {
      return catchToJson(err);
    }
  },
);
