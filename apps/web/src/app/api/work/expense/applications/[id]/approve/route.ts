import { NextResponse } from "next/server";
import { catchToJson } from "@/lib/application/api-errors";
import { approveExpenseApplicationForAccess } from "@/lib/application/expense-service";
import { withPlatformGuard } from "@/lib/platform/api-guard";

type Context = { params: Promise<{ id: string }> };

export const POST = withPlatformGuard<Context>(
  { moduleId: "expense", permission: "expense.manage" },
  async ({ access, context }) => {
    try {
      const { id } = await context.params;
      const application = await approveExpenseApplicationForAccess(access, id);
      return NextResponse.json({ ok: true, application });
    } catch (err) {
      return catchToJson(err);
    }
  },
);
