import type { ConfidentialityLevel, Visibility } from "@regapro/shared";
import type { StaffRecord } from "@regapro/platform";
import type { PermissionGrant } from "@regapro/shared";
import {
  buildAccessContext,
  listEffectivePermissions,
  type AccessContext,
} from "@regapro/security";
import type { LiveMembership } from "./membership-types";

export type SessionAccessBundle = {
  /** Null on the staff-only path — never a synthetic membership. */
  membership: LiveMembership | null;
  identity: {
    userId: string;
    email: string;
    displayName: string;
    organizationId: string;
  };
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
    identity: {
      userId: membership.userId,
      email: membership.email,
      displayName: membership.displayName,
      organizationId: membership.organizationId,
    },
    access,
    maximumConfidentialityLevel: access.maximumConfidentialityLevel,
    permissions: listEffectivePermissions({
      roles: membership.roles,
      extraPermissions: membership.permissionKeys,
    }),
  };
}

/**
 * Staff-only AccessContext. No membership id, no department key, company
 * Knowledge Clearance ceiling, empty AI role/permission keys.
 */
export function buildAccessContextFromStaff(input: {
  userId: string;
  email: string;
  displayName: string;
  staff: StaffRecord;
  grants: PermissionGrant[];
  roleIds: string[];
  opts?: {
    threadLevel?: ConfidentialityLevel;
    threadVisibility?: Visibility;
    participantThreadIds?: string[];
    projectIds?: string[];
    auditMode?: boolean;
    auditCaseId?: string | null;
  };
}): SessionAccessBundle {
  const access = buildAccessContext({
    userId: input.userId,
    authUserId: input.userId,
    organizationId: input.staff.organizationId,
    membershipId: null,
    departmentId: input.staff.primaryDepartmentId,
    departmentKey: null,
    roles: [],
    staff: {
      staffId: input.staff.staffId,
      staffNo: input.staff.staffNo,
      name: input.staff.name,
      employmentType: input.staff.employmentType,
      status: input.staff.status,
    },
    departmentIds: input.staff.departmentIds,
    roleIds: input.roleIds,
    permissions: input.grants,
    threadConfidentialityLevel: input.opts?.threadLevel ?? "company",
    threadVisibility: input.opts?.threadVisibility ?? "private",
    projectIds: input.opts?.projectIds ?? [],
    participantThreadIds: input.opts?.participantThreadIds ?? [],
    auditMode: input.opts?.auditMode,
    auditCaseId: input.opts?.auditCaseId,
  });

  return {
    membership: null,
    identity: {
      userId: input.userId,
      email: input.email,
      displayName: input.displayName || input.staff.name,
      organizationId: input.staff.organizationId,
    },
    access,
    maximumConfidentialityLevel: access.maximumConfidentialityLevel,
    permissions: [],
  };
}
