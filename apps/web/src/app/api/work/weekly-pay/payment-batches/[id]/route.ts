import { NextResponse } from "next/server";
import { catchToJson } from "@/lib/application/api-errors";
import { getPaymentBatchForAccess } from "@/lib/application/weekly-pay-service";
import { withPlatformGuard } from "@/lib/platform/api-guard";

type Context = { params: Promise<{ id: string }> };

export const GET = withPlatformGuard<Context>(
  { anyPermissions: ["weekly_pay.pay", "weekly_pay.manage"] },
  async ({ access, context }) => {
    try {
      const { id } = await context.params;
      const batch = await getPaymentBatchForAccess(access, id);
      return NextResponse.json({ ok: true, batch });
    } catch (err) {
      return catchToJson(err);
    }
  },
);
