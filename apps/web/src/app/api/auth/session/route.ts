import { NextResponse } from "next/server";
import { selectableLevelsForClearance } from "@regapro/shared";
import { isDevSampleMode } from "@/lib/supabase/env";
import { getSessionAccess, getSessionUser } from "@/lib/supabase/auth";
import { catchToJson } from "@/lib/application/api-errors";

/**
 * Session probe for live connection (membership + clearance summary).
 * In dev-sample mode returns fixture identity only.
 */
export async function GET() {
  try {
    if (isDevSampleMode()) {
      const user = await getSessionUser();
      return NextResponse.json({
        mode: "dev-sample",
        user,
        membership: null,
        note: "Live membership/AccessContext is inactive until REGAPRO_DATA_MODE=supabase.",
      });
    }

    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json(
        { mode: "supabase", user: null, membership: null },
        { status: 401 },
      );
    }

    const access = await getSessionAccess();
    if (!access) {
      return NextResponse.json(
        {
          mode: "supabase",
          user,
          membership: null,
          error: "NO_ORGANIZATION_MEMBERSHIP",
        },
        { status: 403 },
      );
    }

    return NextResponse.json({
      mode: "supabase",
      user: {
        id: access.membership.userId,
        email: access.membership.email,
        displayName: access.membership.displayName,
      },
      membership: {
        organizationId: access.membership.organizationId,
        organizationName: access.membership.organizationName,
        membershipId: access.membership.membershipId,
        departmentId: access.membership.departmentId,
        departmentKey: access.membership.departmentKey,
        departmentLabel: access.membership.departmentLabel,
        roles: access.membership.roles,
        clearanceOverride: access.membership.clearanceOverride,
        maximumConfidentialityLevel: access.maximumConfidentialityLevel,
        selectableLevels: selectableLevelsForClearance(
          access.maximumConfidentialityLevel,
        ),
        permissions: access.permissions,
      },
    });
  } catch (err) {
    return catchToJson(err);
  }
}
