import "server-only";
import { cache } from "react";
import type { AccessContext } from "@regapro/security";
import { distinctScopes } from "@regapro/security";
import { withLegacyCompatibilityGrants } from "@regapro/platform";
import { resolveAppSession, type AppSession } from "@/lib/application/session-access";
import { resolveCurrentStaff } from "./staff-resolution";

/**
 * Platform API — the one place that assembles an AccessContext for the
 * integrated app.
 *
 * It layers staff identity and Feature Permissions on top of the existing AI
 * session without altering it: knowledge clearance, visibility, and thread
 * scoping keep coming from the AI membership exactly as before.
 *
 * Known Phase 5 gap: a staff member with no AI organization membership cannot
 * resolve a session yet, because clearance is still derived from the membership
 * department. Staff-only sessions land with the first business module.
 */

export type PlatformSession = AppSession & {
  access: AccessContext;
  /** True while the caller has no linked staff record. */
  compatibilityMode: boolean;
};

export const resolvePlatformSession = cache(
  async (): Promise<PlatformSession> => {
    const session = await resolveAppSession();
    const resolved = await resolveCurrentStaff();

    if (!resolved) {
      return {
        ...session,
        access: withLegacyCompatibilityGrants(session.access),
        compatibilityMode: true,
      };
    }

    const { staff, grants, roleIds } = resolved;
    const departmentIds =
      staff.departmentIds.length > 0
        ? staff.departmentIds
        : session.access.departmentId
          ? [session.access.departmentId]
          : [];

    return {
      ...session,
      access: {
        ...session.access,
        authUserId: session.access.userId,
        staffId: staff.staffId,
        staffNo: staff.staffNo,
        employmentType: staff.employmentType,
        staffStatus: staff.status,
        departmentIds,
        roleIds,
        permissions: grants,
        scopes: distinctScopes(grants),
      },
      compatibilityMode: false,
    };
  },
);

/** Platform API — AccessContext only, for guards and services. */
export async function resolveAccessContext(): Promise<AccessContext> {
  return (await resolvePlatformSession()).access;
}
