import { NextResponse } from "next/server";
import { UpsertWeeklyPayPolicySchema } from "@regapro/work";
import { catchToJson, jsonError } from "@/lib/application/api-errors";
import {
  listWeeklyPayPoliciesForAccess,
  upsertWeeklyPayPolicyForAccess,
} from "@/lib/application/weekly-pay-service";
import { withPlatformGuard } from "@/lib/platform/api-guard";

export const GET = withPlatformGuard(
  {
    anyPermissions: [
      "weekly_pay.submit",
      "weekly_pay.review",
      "weekly_pay.pay",
      "weekly_pay.manage",
      "weekly_pay.policy_manage",
    ],
  },
  async ({ access }) => {
    try {
      const policies = await listWeeklyPayPoliciesForAccess(access);
      return NextResponse.json({ ok: true, policies });
    } catch (err) {
      return catchToJson(err);
    }
  },
);

export const POST = withPlatformGuard(
  { anyPermissions: ["weekly_pay.policy_manage"] },
  async ({ request, access }) => {
    try {
      const parsed = UpsertWeeklyPayPolicySchema.safeParse(
        await request.json().catch(() => null),
      );
      if (!parsed.success) return jsonError("VALIDATION");
      const policy = await upsertWeeklyPayPolicyForAccess(access, parsed.data);
      return NextResponse.json({ ok: true, policy });
    } catch (err) {
      return catchToJson(err);
    }
  },
);
