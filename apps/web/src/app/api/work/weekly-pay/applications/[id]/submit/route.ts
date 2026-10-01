import { NextResponse } from "next/server";
import { catchToJson } from "@/lib/application/api-errors";
import { submitWeeklyApplicationForAccess } from "@/lib/application/weekly-pay-service";
import { withPlatformGuard } from "@/lib/platform/api-guard";

type Context = { params: Promise<{ id: string }> };

export const POST = withPlatformGuard<Context>(
  { anyPermissions: ["weekly_pay.submit", "weekly_pay.manage"] },
  async ({ access, context }) => {
    try {
      const { id } = await context.params;
      const application = await submitWeeklyApplicationForAccess(access, id);
      return NextResponse.json({ ok: true, application });
    } catch (err) {
      return catchToJson(err);
    }
  },
);
