import type { ConfidentialityLevel, Visibility } from "@regapro/shared";
import {
  buildAccessContext,
  listEffectivePermissions,
  type AccessContext,
} from "@regapro/security";
import type { LiveMembership } from "./membership-types";

export type SessionAccessBundle = {
  membership: LiveMembership;
  access: AccessContext;
  maximumConfidentialityLevel: ConfidentialityLevel;
  permissions: ReturnType<typeof listEffectivePermissions>;
};

/**
 * Builds AccessContext from a live DB membership.
 * RLS remains the authoritative boundary; this is application defense-in-depth.
 */
export function buildAccessContextFromMembership(
  membership: LiveMembership,
  opts?: {
    threadLevel?: ConfidentialityLevel;
    threadVisibility?: Visibility;
    participantThreadIds?: string[];
    projectIds?: string[];
    auditMode?: boolean;
    auditCaseId?: string | null;
  },
): SessionAccessBundle {
  const access = buildAccessContext({
    userId: membership.userId,
    organizationId: membership.organizationId,
    membershipId: membership.membershipId,
    departmentId: membership.departmentId,
    departmentKey: membership.departmentKey,
    roles: membership.roles,
    clearanceOverride: membership.clearanceOverride,
    threadConfidentialityLevel: opts?.threadLevel ?? "company",
    threadVisibility: opts?.threadVisibility ?? "private",
    projectIds: opts?.projectIds ?? [],
    participantThreadIds: opts?.participantThreadIds ?? [],
    auditMode: opts?.auditMode,
    auditCaseId: opts?.auditCaseId,
    // Permissions present in DB but not in ROLE_PERMISSIONS templates.
    extraPermissions: membership.permissionKeys.filter(
      (p) =>
        !listEffectivePermissions({ roles: membership.roles }).includes(p),
    ),
  });

  return {
    membership,
    access,
    maximumConfidentialityLevel: access.maximumConfidentialityLevel,
    permissions: listEffectivePermissions({
      roles: membership.roles,
      extraPermissions: membership.permissionKeys,
    }),
  };
}
