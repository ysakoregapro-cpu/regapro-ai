import { NextResponse } from "next/server";
import { CreateWeeklyPayPaymentBatchSchema } from "@regapro/work";
import { catchToJson, jsonError } from "@/lib/application/api-errors";
import {
  createPaymentBatchForAccess,
  listPaymentBatchesForAccess,
} from "@/lib/application/weekly-pay-service";
import { withPlatformGuard } from "@/lib/platform/api-guard";

export const GET = withPlatformGuard(
  { anyPermissions: ["weekly_pay.pay", "weekly_pay.manage"] },
  async ({ access }) => {
    try {
      const batches = await listPaymentBatchesForAccess(access);
      return NextResponse.json({ ok: true, batches });
    } catch (err) {
      return catchToJson(err);
    }
  },
);

export const POST = withPlatformGuard(
  { anyPermissions: ["weekly_pay.pay", "weekly_pay.manage"] },
  async ({ request, access }) => {
    try {
      const parsed = CreateWeeklyPayPaymentBatchSchema.safeParse(
        await request.json().catch(() => null),
      );
      if (!parsed.success) return jsonError("VALIDATION");
      const batch = await createPaymentBatchForAccess(access, parsed.data);
      return NextResponse.json({ ok: true, batch });
    } catch (err) {
      return catchToJson(err);
    }
  },
);
