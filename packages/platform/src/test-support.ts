import type {
  EmploymentType,
  PermissionGrant,
  Permission,
  Role,
  StaffStatus,
} from "@regapro/shared";
import { ORGANIZATION_SCOPE } from "@regapro/shared";
import { buildAccessContext, type AccessContext } from "@regapro/security";

/** Fixtures for permission-engine tests. Not part of the package's public API. */

export const ORG_A = "11111111-1111-1111-1111-111111111111";
export const ORG_B = "22222222-2222-2222-2222-222222222222";
export const DEPT_SALES = "33333333-3333-3333-3333-333333333333";
export const DEPT_PEOPLE = "44444444-4444-4444-4444-444444444444";
export const PROJECT_ALPHA = "55555555-5555-5555-5555-555555555555";

export function makeAccess(input: {
  staffId?: string | null;
  employmentType?: EmploymentType;
  staffStatus?: StaffStatus;
  grants?: PermissionGrant[];
  legacyPermissions?: Permission[];
  roles?: Role[];
  organizationId?: string;
  departmentIds?: string[];
}): AccessContext {
  const staffId = input.staffId === undefined ? "staff-1" : input.staffId;
  return buildAccessContext({
    userId: "auth-user-1",
    authUserId: "auth-user-1",
    organizationId: input.organizationId ?? ORG_A,
    membershipId: "membership-1",
    departmentId: input.departmentIds?.[0] ?? DEPT_SALES,
    departmentKey: "sales",
    roles: input.roles ?? [],
    extraPermissions: input.legacyPermissions ?? [],
    departmentIds: input.departmentIds ?? [DEPT_SALES],
    permissions: input.grants ?? [],
    staff: staffId
      ? {
          staffId,
          staffNo: "S-0001",
          name: "テスト太郎",
          employmentType: input.employmentType ?? "employee",
          status: input.staffStatus ?? "active",
        }
      : null,
  });
}

export function grant(
  permission: PermissionGrant["permission"],
  scope: PermissionGrant["scope"] = ORGANIZATION_SCOPE,
): PermissionGrant {
  return { permission, scope, effect: "allow", source: "role", roleId: "role-1" };
}

export function deny(
  permission: PermissionGrant["permission"],
  scope: PermissionGrant["scope"] = ORGANIZATION_SCOPE,
): PermissionGrant {
  return { permission, scope, effect: "deny", source: "override", roleId: null };
}
