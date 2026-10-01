import { NextResponse } from "next/server";
import { catchToJson } from "@/lib/application/api-errors";
import { getApplicationBankSnapshotForAccess } from "@/lib/application/weekly-pay-service";
import { withPlatformGuard } from "@/lib/platform/api-guard";

type Context = { params: Promise<{ id: string }> };

export const GET = withPlatformGuard<Context>(
  {
    anyPermissions: [
      "weekly_pay.submit",
      "weekly_pay.review",
      "weekly_pay.pay",
      "weekly_pay.manage",
    ],
  },
  async ({ access, context }) => {
    try {
      const { id } = await context.params;
      const snapshot = await getApplicationBankSnapshotForAccess(access, id);
      return NextResponse.json({ ok: true, snapshot });
    } catch (err) {
      return catchToJson(err);
    }
  },
);
