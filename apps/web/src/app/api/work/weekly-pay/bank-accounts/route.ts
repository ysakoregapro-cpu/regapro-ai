import { NextResponse } from "next/server";
import { BankAccountListQuerySchema, UpsertBankAccountSchema } from "@regapro/work";
import { catchToJson, jsonError } from "@/lib/application/api-errors";
import {
  listBankAccountsForAccess,
  upsertBankAccountForAccess,
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
      const parsed = BankAccountListQuerySchema.safeParse({
        staffId: url.searchParams.get("staffId") ?? undefined,
      });
      if (!parsed.success) return jsonError("VALIDATION");
      const bankAccounts = await listBankAccountsForAccess(access, parsed.data.staffId);
      return NextResponse.json({ ok: true, bankAccounts });
    } catch (err) {
      return catchToJson(err);
    }
  },
);

export const POST = withPlatformGuard(
  { anyPermissions: ["weekly_pay.submit", "weekly_pay.manage"] },
  async ({ request, access }) => {
    try {
      const parsed = UpsertBankAccountSchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return jsonError("VALIDATION");
      const bankAccount = await upsertBankAccountForAccess(access, parsed.data);
      return NextResponse.json({ ok: true, bankAccount });
    } catch (err) {
      return catchToJson(err);
    }
  },
);
