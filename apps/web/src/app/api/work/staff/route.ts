import { NextResponse } from "next/server";
import { catchToJson, jsonError } from "@/lib/application/api-errors";
import { withPlatformGuard } from "@/lib/platform/api-guard";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const GET = withPlatformGuard(
  {
    anyPermissions: [
      "shift.manage",
      "work_record.manage",
      "employment_terms.manage",
    ],
  },
  async ({ access }) => {
    try {
      if (!access.organizationId) return jsonError("FORBIDDEN");
      const client = await createServerSupabaseClient();
      const { data, error } = await client
        .from("staff")
        .select("staff_id, staff_no, name, employment_type, status")
        .eq("org_id", access.organizationId)
        .eq("status", "active")
        .order("staff_no", { ascending: true });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Array<Record<string, unknown>>;
      const staff = rows.map((row) => ({
        staffId: String(row.staff_id),
        staffNo: typeof row.staff_no === "string" ? row.staff_no : "",
        name: typeof row.name === "string" ? row.name : "",
        employmentType:
          typeof row.employment_type === "string" ? row.employment_type : "",
        status: typeof row.status === "string" ? row.status : "",
      }));
      return NextResponse.json({ ok: true, staff });
    } catch (err) {
      return catchToJson(err);
    }
  },
);
