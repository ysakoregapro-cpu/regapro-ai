import { NextResponse } from "next/server";
import {
  CreateEmploymentTermSchema,
  EmploymentTermListQuerySchema,
} from "@regapro/work";
import { jsonError } from "@/lib/application/api-errors";
import {
  createEmploymentTermForAccess,
  listEmploymentTermsForAccess,
} from "@/lib/application/work-record-service";
import { withPlatformGuard } from "@/lib/platform/api-guard";

export const GET = withPlatformGuard(
  {
    anyPermissions: [
      "work_record.view_own",
      "work_record.submit",
      "work_record.manage",
      "employment_terms.manage",
    ],
  },
  async ({ request, access }) => {
    const url = new URL(request.url);
    const parsed = EmploymentTermListQuerySchema.safeParse({
      staffId: url.searchParams.get("staffId") ?? undefined,
    });
    if (!parsed.success) return jsonError("VALIDATION");
    const terms = await listEmploymentTermsForAccess(access, parsed.data);
    return NextResponse.json({ ok: true, terms });
  },
);

export const POST = withPlatformGuard(
  { permission: "employment_terms.manage" },
  async ({ request, access }) => {
    const parsed = CreateEmploymentTermSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("VALIDATION");
    const term = await createEmploymentTermForAccess(access, parsed.data);
    return NextResponse.json({ ok: true, term });
  },
);
