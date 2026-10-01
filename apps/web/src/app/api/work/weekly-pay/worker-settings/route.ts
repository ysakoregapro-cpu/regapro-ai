import { NextResponse } from "next/server";
import { UpsertWorkerSettingsSchema } from "@regapro/work";
import { catchToJson, jsonError } from "@/lib/application/api-errors";
import {
  getWorkerSettingsForAccess,
  upsertWorkerSettingsForAccess,
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
      const staffId = url.searchParams.get("staffId") ?? undefined;
      const settings = await getWorkerSettingsForAccess(access, staffId);
      return NextResponse.json({ ok: true, settings });
    } catch (err) {
      return catchToJson(err);
    }
  },
);

export const POST = withPlatformGuard(
  { anyPermissions: ["weekly_pay.submit", "weekly_pay.manage"] },
  async ({ request, access }) => {
    try {
      const parsed = UpsertWorkerSettingsSchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return jsonError("VALIDATION");
      const settings = await upsertWorkerSettingsForAccess(access, parsed.data);
      return NextResponse.json({ ok: true, settings });
    } catch (err) {
      return catchToJson(err);
    }
  },
);
