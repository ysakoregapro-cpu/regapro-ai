import { NextResponse } from "next/server";
import { catchToJson } from "@/lib/application/api-errors";
import { listSettlementLedgerForAccess } from "@/lib/application/weekly-pay-service";
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
      const entries = await listSettlementLedgerForAccess(access, staffId);
      return NextResponse.json({ ok: true, entries });
    } catch (err) {
      return catchToJson(err);
    }
  },
);
