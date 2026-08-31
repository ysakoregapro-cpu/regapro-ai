import type {
  EmploymentType,
  IdentityType,
  PermissionGrant,
  StaffRef,
  StaffStatus,
} from "@regapro/shared";

/**
 * Ports the app implements against Supabase. Keeping them here lets the
 * permission engine and its tests run without a database.
 */

export type StaffRecord = StaffRef & {
  organizationId: string;
  joinedAt: string | null;
  leftAt: string | null;
  departmentIds: string[];
  primaryDepartmentId: string | null;
};

export type StaffIdentityRecord = {
  id: string;
  staffId: string;
  identityType: IdentityType;
  sourceSystem: string;
  externalUserId: string;
  authUserId: string | null;
};

export type StaffDirectoryPort = {
  /** Canonical resolution: login identity → person. `null` when unmapped. */
  findStaffByAuthUserId(authUserId: string): Promise<StaffRecord | null>;
  /** Used by legacy imports to map an external id onto a staff member. */
  findStaffBySourceIdentity(input: {
    sourceSystem: string;
    externalUserId: string;
  }): Promise<StaffRecord | null>;
};

export type PlatformRbacPort = {
  /** Role grants merged with staff-level overrides, already scope-resolved. */
  loadGrants(input: {
    staffId: string;
    organizationId: string;
  }): Promise<{ grants: PermissionGrant[]; roleIds: string[] }>;
};

/** Section S — permission and role changes must be reconstructable. */
export type PermissionAuditEvent = {
  organizationId: string;
  /** Who performed the change. */
  actorStaffId: string | null;
  actorAuthUserId: string | null;
  /** Which staff member the change is about. */
  subjectStaffId: string | null;
  action:
    | "role_assigned"
    | "role_revoked"
    | "override_granted"
    | "override_revoked"
    | "staff_created"
    | "staff_status_changed"
    | "identity_linked"
    | "identity_unlinked";
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  occurredAt: string;
};

export type PermissionAuditPort = {
  record(event: PermissionAuditEvent): Promise<void>;
};

export type StaffProvisioningInput = {
  organizationId: string;
  staffNo: string;
  name: string;
  employmentType: EmploymentType;
  status?: StaffStatus;
  joinedAt?: string | null;
};
