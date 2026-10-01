import { NextResponse } from "next/server";
import { ReturnWeeklyApplicationSchema } from "@regapro/work";
import { catchToJson, jsonError } from "@/lib/application/api-errors";
import { returnWeeklyApplicationForAccess } from "@/lib/application/weekly-pay-service";
import { withPlatformGuard } from "@/lib/platform/api-guard";

type Context = { params: Promise<{ id: string }> };

export const POST = withPlatformGuard<Context>(
  { anyPermissions: ["weekly_pay.review", "weekly_pay.manage"] },
  async ({ request, access, context }) => {
    try {
      const { id } = await context.params;
      const parsed = ReturnWeeklyApplicationSchema.safeParse(
        await request.json().catch(() => null),
      );
      if (!parsed.success) return jsonError("VALIDATION");
      const application = await returnWeeklyApplicationForAccess(
        access,
        id,
        parsed.data.reason,
      );
      return NextResponse.json({ ok: true, application });
    } catch (err) {
      return catchToJson(err);
    }
  },
);
