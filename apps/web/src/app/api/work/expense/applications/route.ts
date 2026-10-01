import { NextResponse } from "next/server";
import {
  ExpenseApplicationListQuerySchema,
  UpsertExpenseApplicationDraftSchema,
} from "@regapro/work";
import { catchToJson, jsonError } from "@/lib/application/api-errors";
import {
  listExpenseApplicationsForAccess,
  upsertExpenseApplicationDraftForAccess,
} from "@/lib/application/expense-service";
import { withPlatformGuard } from "@/lib/platform/api-guard";

export const GET = withPlatformGuard(
  {
    moduleId: "expense",
    anyPermissions: ["expense.submit", "expense.view_own", "expense.manage"],
  },
  async ({ request, access }) => {
    try {
      const url = new URL(request.url);
      const parsed = ExpenseApplicationListQuerySchema.safeParse({
        from: url.searchParams.get("from") ?? undefined,
        to: url.searchParams.get("to") ?? undefined,
        staffId: url.searchParams.get("staffId") ?? undefined,
        status: url.searchParams.get("status") ?? undefined,
      });
      if (!parsed.success) return jsonError("VALIDATION");
      const applications = await listExpenseApplicationsForAccess(access, parsed.data);
      return NextResponse.json({ ok: true, applications });
    } catch (err) {
      return catchToJson(err);
    }
  },
);

export const POST = withPlatformGuard(
  { moduleId: "expense", anyPermissions: ["expense.submit", "expense.manage"] },
  async ({ request, access }) => {
    try {
      const parsed = UpsertExpenseApplicationDraftSchema.safeParse(
        await request.json().catch(() => null),
      );
      if (!parsed.success) return jsonError("VALIDATION");
      const application = await upsertExpenseApplicationDraftForAccess(access, parsed.data);
      return NextResponse.json({ ok: true, application });
    } catch (err) {
      return catchToJson(err);
    }
  },
);
