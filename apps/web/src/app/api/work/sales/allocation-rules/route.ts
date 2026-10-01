import { NextResponse } from "next/server";
import { UpsertAllocationRuleDraftSchema } from "@regapro/work";
import { catchToJson, jsonError } from "@/lib/application/api-errors";
import {
  listAllocationRulesForAccess,
  upsertAllocationRuleDraftForAccess,
} from "@/lib/application/sales-service";
import { withPlatformGuard } from "@/lib/platform/api-guard";

export const GET = withPlatformGuard(
  { moduleId: "sales", permission: "sales.manage" },
  async ({ access }) => {
    try {
      const rules = await listAllocationRulesForAccess(access);
      return NextResponse.json({ ok: true, rules });
    } catch (err) {
      return catchToJson(err);
    }
  },
);

export const POST = withPlatformGuard(
  { moduleId: "sales", permission: "sales.manage" },
  async ({ request, access }) => {
    try {
      const parsed = UpsertAllocationRuleDraftSchema.safeParse(
        await request.json().catch(() => null),
      );
      if (!parsed.success) return jsonError("VALIDATION");
      const rule = await upsertAllocationRuleDraftForAccess(access, {
        ...parsed.data,
        rulePayload: parsed.data.rulePayload ?? {},
      });
      return NextResponse.json({ ok: true, rule });
    } catch (err) {
      return catchToJson(err);
    }
  },
);
