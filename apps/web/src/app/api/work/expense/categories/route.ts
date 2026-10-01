import { NextResponse } from "next/server";
import { catchToJson } from "@/lib/application/api-errors";
import { listExpenseCategoriesForAccess } from "@/lib/application/expense-service";
import { withPlatformGuard } from "@/lib/platform/api-guard";

export const GET = withPlatformGuard(
  {
    moduleId: "expense",
    anyPermissions: ["expense.submit", "expense.view_own", "expense.manage"],
  },
  async ({ access }) => {
    try {
      const categories = await listExpenseCategoriesForAccess(access);
      return NextResponse.json({ ok: true, categories });
    } catch (err) {
      return catchToJson(err);
    }
  },
);
