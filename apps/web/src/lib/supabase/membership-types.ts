import type {
  ConfidentialityLevel,
  DepartmentKey,
  Permission,
  Role,
} from "@regapro/shared";

/** Domain-facing live membership (not a generated DB row). */
export type LiveMembership = {
  userId: string;
  email: string;
  displayName: string;
  organizationId: string;
  organizationName: string;
  membershipId: string;
  departmentId: string | null;
  departmentKey: DepartmentKey;
  departmentLabel: string;
  roles: Role[];
  permissionKeys: Permission[];
  clearanceOverride: ConfidentialityLevel | null;
  effectiveClearanceRank: 1 | 2 | 3;
};
