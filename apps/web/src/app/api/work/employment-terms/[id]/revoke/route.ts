import { NextResponse } from "next/server";
import { RevokeEmploymentTermSchema } from "@regapro/work";
import { jsonError } from "@/lib/application/api-errors";
import { revokeEmploymentTermForAccess } from "@/lib/application/work-record-service";
import { withPlatformGuard } from "@/lib/platform/api-guard";

type Context = { params: Promise<{ id: string }> };

export const POST = withPlatformGuard<Context>(
  { permission: "employment_terms.manage" },
  async ({ request, access, context }) => {
    const parsed = RevokeEmploymentTermSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("VALIDATION");
    const { id } = await context.params;
    const term = await revokeEmploymentTermForAccess(access, id, parsed.data.reason);
    return NextResponse.json({ ok: true, term });
  },
);
