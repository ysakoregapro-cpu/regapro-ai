import { NextResponse } from "next/server";
import { UpsertWeeklyPayTransferorSettingsSchema } from "@regapro/work";
import { catchToJson, jsonError } from "@/lib/application/api-errors";
import {
  getTransferorSettingsForAccess,
  upsertTransferorSettingsForAccess,
} from "@/lib/application/weekly-pay-service";
import { withPlatformGuard } from "@/lib/platform/api-guard";

export const GET = withPlatformGuard(
  { anyPermissions: ["weekly_pay.pay", "weekly_pay.manage"] },
  async ({ access }) => {
    try {
      const settings = await getTransferorSettingsForAccess(access);
      return NextResponse.json({ ok: true, settings });
    } catch (err) {
      return catchToJson(err);
    }
  },
);

export const POST = withPlatformGuard(
  { anyPermissions: ["weekly_pay.pay", "weekly_pay.manage"] },
  async ({ request, access }) => {
    try {
      const parsed = UpsertWeeklyPayTransferorSettingsSchema.safeParse(
        await request.json().catch(() => null),
      );
      if (!parsed.success) return jsonError("VALIDATION");
      const settings = await upsertTransferorSettingsForAccess(access, parsed.data);
      return NextResponse.json({ ok: true, settings });
    } catch (err) {
      return catchToJson(err);
    }
  },
);
