import { NextResponse } from "next/server";
import { catchToJson } from "@/lib/application/api-errors";
import { downloadPaymentBatchCsvForAccess } from "@/lib/application/weekly-pay-service";
import { withPlatformGuard } from "@/lib/platform/api-guard";

type Context = { params: Promise<{ id: string }> };

export const GET = withPlatformGuard<Context>(
  { anyPermissions: ["weekly_pay.pay", "weekly_pay.manage"] },
  async ({ access, context }) => {
    try {
      const { id } = await context.params;
      const file = await downloadPaymentBatchCsvForAccess(access, id);
      return new NextResponse(new Uint8Array(file.buffer), {
        status: 200,
        headers: {
          "Content-Type": file.contentType,
          "Content-Disposition": `attachment; filename="${file.filename}"`,
          "Cache-Control": "no-store, no-cache, must-revalidate, private",
          Pragma: "no-cache",
          "X-Content-Fingerprint": file.batch.contentFingerprint,
        },
      });
    } catch (err) {
      return catchToJson(err);
    }
  },
);
