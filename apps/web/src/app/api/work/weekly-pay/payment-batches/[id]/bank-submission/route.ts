import { NextResponse } from "next/server";
import { RecordBankSubmissionSchema } from "@regapro/work";
import { catchToJson, jsonError } from "@/lib/application/api-errors";
import { recordBankSubmissionForAccess } from "@/lib/application/weekly-pay-service";
import { withPlatformGuard } from "@/lib/platform/api-guard";

type Context = { params: Promise<{ id: string }> };

export const POST = withPlatformGuard<Context>(
  { anyPermissions: ["weekly_pay.pay", "weekly_pay.manage"] },
  async ({ request, access, context }) => {
    try {
      const { id } = await context.params;
      const parsed = RecordBankSubmissionSchema.safeParse(
        await request.json().catch(() => null),
      );
      if (!parsed.success) return jsonError("VALIDATION");
      const batch = await recordBankSubmissionForAccess(
        access,
        id,
        parsed.data.note,
        parsed.data.bankFileRef,
      );
      return NextResponse.json({ ok: true, batch });
    } catch (err) {
      return catchToJson(err);
    }
  },
);
