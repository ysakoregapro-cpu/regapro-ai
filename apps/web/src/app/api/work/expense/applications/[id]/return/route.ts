import { NextResponse } from "next/server";
import { ReturnExpenseApplicationSchema } from "@regapro/work";
import { catchToJson, jsonError } from "@/lib/application/api-errors";
import { returnExpenseApplicationForAccess } from "@/lib/application/expense-service";
import { withPlatformGuard } from "@/lib/platform/api-guard";

type Context = { params: Promise<{ id: string }> };

export const POST = withPlatformGuard<Context>(
  { moduleId: "expense", permission: "expense.manage" },
  async ({ request, access, context }) => {
    try {
      const parsed = ReturnExpenseApplicationSchema.safeParse(
        await request.json().catch(() => null),
      );
      if (!parsed.success) return jsonError("VALIDATION");
      const { id } = await context.params;
      const application = await returnExpenseApplicationForAccess(
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
