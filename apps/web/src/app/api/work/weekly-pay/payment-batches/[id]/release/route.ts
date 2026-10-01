import { NextResponse } from "next/server";
import { z } from "zod";
import { ReleaseItemForResendSchema } from "@regapro/work";
import { catchToJson, jsonError } from "@/lib/application/api-errors";
import { releaseItemForResendForAccess } from "@/lib/application/weekly-pay-service";
import { withPlatformGuard } from "@/lib/platform/api-guard";

type Context = { params: Promise<{ id: string }> };

const BodySchema = ReleaseItemForResendSchema.extend({
  itemId: z.string().uuid(),
});

export const POST = withPlatformGuard<Context>(
  { anyPermissions: ["weekly_pay.pay", "weekly_pay.manage"] },
  async ({ request, access }) => {
    try {
      const parsed = BodySchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return jsonError("VALIDATION");
      const { itemId, ...input } = parsed.data;
      const item = await releaseItemForResendForAccess(access, itemId, input);
      return NextResponse.json({ ok: true, item });
    } catch (err) {
      return catchToJson(err);
    }
  },
);
