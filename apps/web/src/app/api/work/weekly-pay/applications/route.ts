import { NextResponse } from "next/server";
import {
  CreateWeeklyApplicationDraftSchema,
  WeeklyApplicationListQuerySchema,
} from "@regapro/work";
import { catchToJson, jsonError } from "@/lib/application/api-errors";
import {
  createWeeklyApplicationDraftForAccess,
  listWeeklyApplicationsForAccess,
} from "@/lib/application/weekly-pay-service";
import { withPlatformGuard } from "@/lib/platform/api-guard";

export const GET = withPlatformGuard(
  {
    anyPermissions: [
      "weekly_pay.submit",
      "weekly_pay.review",
      "weekly_pay.pay",
      "weekly_pay.manage",
    ],
  },
  async ({ request, access }) => {
    try {
      const url = new URL(request.url);
      const parsed = WeeklyApplicationListQuerySchema.safeParse({
        fromWeekStart: url.searchParams.get("fromWeekStart") ?? undefined,
        toWeekStart: url.searchParams.get("toWeekStart") ?? undefined,
        staffId: url.searchParams.get("staffId") ?? undefined,
        status: url.searchParams.get("status") ?? undefined,
      });
      if (!parsed.success) return jsonError("VALIDATION");
      const applications = await listWeeklyApplicationsForAccess(access, parsed.data);
      return NextResponse.json({ ok: true, applications });
    } catch (err) {
      return catchToJson(err);
    }
  },
);

export const POST = withPlatformGuard(
  { anyPermissions: ["weekly_pay.submit", "weekly_pay.manage"] },
  async ({ request, access }) => {
    try {
      const parsed = CreateWeeklyApplicationDraftSchema.safeParse(
        await request.json().catch(() => null),
      );
      if (!parsed.success) return jsonError("VALIDATION");
      const application = await createWeeklyApplicationDraftForAccess(access, parsed.data);
      return NextResponse.json({ ok: true, application });
    } catch (err) {
      return catchToJson(err);
    }
  },
);
