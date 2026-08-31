import { z } from "zod";

/**
 * Canonical person identity for the integrated app.
 *
 * `staff.staff_id` — not `auth.users.id` — is the canonical person key.
 * `auth.users.id` stays a *login* identity and is mapped onto a staff record
 * through `staff_identities`. Both may coexist indefinitely; nothing in this
 * module assumes the two ids are ever equal.
 */

/**
 * Employment type describes the contractual relationship only.
 * It MUST NOT be used to decide feature access — see `platform-permissions.ts`.
 * Extending this list requires updating the `staff.employment_type` CHECK constraint.
 */
export const EMPLOYMENT_TYPES = ["executive", "employee", "part_time"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  executive: "役員",
  employee: "社員",
  part_time: "アルバイト",
};

/** Only `active` staff may resolve an access context. */
export const STAFF_STATUSES = ["active", "suspended", "left"] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];

export const STAFF_STATUS_LABELS: Record<StaffStatus, string> = {
  active: "在籍",
  suspended: "休止",
  left: "退職",
};

/** What kind of credential an identity row represents. */
export const IDENTITY_TYPES = [
  "app_auth",
  "legacy_user",
  "service_account",
  "external_directory",
] as const;
export type IdentityType = (typeof IDENTITY_TYPES)[number];

/**
 * Known source systems. Free-form text in the database so future systems can be
 * onboarded without a migration; these constants cover the systems we already
 * know we must map.
 */
export const KNOWN_SOURCE_SYSTEMS = [
  "regapro_app",
  "legacy_expense",
  "legacy_sales",
  "legacy_weekly_pay",
] as const;
export type KnownSourceSystem = (typeof KNOWN_SOURCE_SYSTEMS)[number];

export const EmploymentTypeSchema = z.enum(EMPLOYMENT_TYPES);
export const StaffStatusSchema = z.enum(STAFF_STATUSES);
export const IdentityTypeSchema = z.enum(IDENTITY_TYPES);

export const StaffSchema = z.object({
  staffId: z.string().uuid(),
  organizationId: z.string().uuid(),
  /** Human-readable identity. Never reused, never used as a foreign key. */
  staffNo: z.string().min(1).max(32),
  name: z.string().min(1),
  employmentType: EmploymentTypeSchema,
  status: StaffStatusSchema,
  joinedAt: z.string().nullable(),
  leftAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Staff = z.infer<typeof StaffSchema>;

export const StaffIdentitySchema = z.object({
  id: z.string().uuid(),
  staffId: z.string().uuid(),
  identityType: IdentityTypeSchema,
  sourceSystem: z.string().min(1).max(64),
  externalUserId: z.string().min(1).max(255),
  authUserId: z.string().uuid().nullable(),
  metadata: z.record(z.unknown()),
  createdAt: z.string(),
});
export type StaffIdentity = z.infer<typeof StaffIdentitySchema>;

/** Minimal staff projection carried inside an access context. */
export type StaffRef = {
  staffId: string;
  staffNo: string;
  name: string;
  employmentType: EmploymentType;
  status: StaffStatus;
};

export function isActiveStaff(staff: Pick<StaffRef, "status">): boolean {
  return staff.status === "active";
}

/**
 * `staff_no` is a display identifier, so normalise aggressively before compare.
 * Reuse is forbidden by design: rows are never hard-deleted, they move to
 * `status = 'left'`, and the unique index covers left staff too.
 */
export function normalizeStaffNo(raw: string): string {
  return raw.trim().toUpperCase();
}
