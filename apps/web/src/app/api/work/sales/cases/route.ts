import { NextResponse } from "next/server";
import {
  CreatePersonalSalesCaseSchema,
  PersonalSalesCaseListQuerySchema,
} from "@regapro/work";
import { catchToJson, jsonError } from "@/lib/application/api-errors";
import {
  createPersonalSalesCaseForAccess,
  listPersonalSalesCasesForAccess,
} from "@/lib/application/sales-service";
import { withPlatformGuard } from "@/lib/platform/api-guard";

export const GET = withPlatformGuard(
  {
    moduleId: "sales",
    anyPermissions: ["sales.view_own", "sales.manage"],
  },
  async ({ request, access }) => {
    try {
      const url = new URL(request.url);
      const parsed = PersonalSalesCaseListQuerySchema.safeParse({
        from: url.searchParams.get("from") ?? undefined,
        to: url.searchParams.get("to") ?? undefined,
        staffId: url.searchParams.get("staffId") ?? undefined,
        status: url.searchParams.get("status") ?? undefined,
      });
      if (!parsed.success) return jsonError("VALIDATION");
      const cases = await listPersonalSalesCasesForAccess(access, parsed.data);
      return NextResponse.json({ ok: true, cases });
    } catch (err) {
      return catchToJson(err);
    }
  },
);

export const POST = withPlatformGuard(
  { moduleId: "sales", permission: "sales.manage" },
  async ({ request, access }) => {
    try {
      const parsed = CreatePersonalSalesCaseSchema.safeParse(
        await request.json().catch(() => null),
      );
      if (!parsed.success) return jsonError("VALIDATION");
      const salesCase = await createPersonalSalesCaseForAccess(access, parsed.data);
      return NextResponse.json({ ok: true, case: salesCase });
    } catch (err) {
      return catchToJson(err);
    }
  },
);
