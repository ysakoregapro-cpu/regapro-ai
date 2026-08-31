import type {
  EmploymentType,
  PermissionGrant,
  PermissionScope,
  PermissionScopeType,
  StaffStatus,
} from "@regapro/shared";
import {
  EMPLOYMENT_TYPES,
  PERMISSION_SCOPE_TYPES,
  STAFF_STATUSES,
  isPlatformPermission,
} from "@regapro/shared";
import type { StaffRecord } from "@regapro/platform";

/**
 * Staff and RBAC reads, expressed against an injected client so they can be
 * exercised without a database.
 *
 * Structural client type on purpose: the staff tables are absent from the
 * generated Supabase types until the migrations are applied to a linked
 * project. `lib/supabase/membership.ts` uses the same approach.
 */

export type PostgrestError = { message: string; code?: string };

export type PostgrestLike = {
  select: (columns: string) => PostgrestLike;
  eq: (column: string, value: string) => PostgrestLike;
  is: (column: string, value: null) => PostgrestLike;
  limit: (count: number) => PostgrestLike;
  maybeSingle: () => PromiseLike<{ data: unknown; error: PostgrestError | null }>;
  then: PromiseLike<{ data: unknown; error: PostgrestError | null }>["then"];
};

export type PlatformQueryClient = {
  from: (relation: string) => PostgrestLike;
};

/**
 * PostgREST reports an unknown relation as PGRST205 / 42P01. That means the
 * additive migrations are not applied yet — an expected rollout state, not a
 * fault, so the caller falls back to compatibility mode.
 */
export function isMissingRelation(error: PostgrestError | null): boolean {
  if (!error) return false;
  if (error.code === "PGRST205" || error.code === "42P01") return true;
  return /does not exist|schema cache/i.test(error.message ?? "");
}

function parseEmploymentType(raw: unknown): EmploymentType | null {
  return typeof raw === "string" &&
    (EMPLOYMENT_TYPES as readonly string[]).includes(raw)
    ? (raw as EmploymentType)
    : null;
}

function parseStaffStatus(raw: unknown): StaffStatus | null {
  return typeof raw === "string" &&
    (STAFF_STATUSES as readonly string[]).includes(raw)
    ? (raw as StaffStatus)
    : null;
}

function parseScope(
  scopeType: unknown,
  scopeId: unknown,
  staffId: string,
): PermissionScope | null {
  if (
    typeof scopeType !== "string" ||
    !(PERMISSION_SCOPE_TYPES as readonly string[]).includes(scopeType)
  ) {
    return null;
  }
  const type = scopeType as PermissionScopeType;
  if (type === "organization") return { type, id: null };
  if (type === "self") return { type, id: staffId };
  return typeof scopeId === "string" ? { type, id: scopeId } : null;
}

type NestedPermission = { key: string; deleted_at: string | null } | null;

function collectPermissionKeys(nested: unknown): string[] {
  if (!Array.isArray(nested)) return [];
  const keys: string[] = [];
  for (const row of nested) {
    const entry = row as { deleted_at?: string | null; permissions?: NestedPermission };
    if (entry.deleted_at) continue;
    const perm = entry.permissions;
    if (!perm || perm.deleted_at) continue;
    keys.push(perm.key);
  }
  return keys;
}

export type StaffLookupResult =
  | { kind: "found"; staff: StaffRecord }
  | { kind: "unlinked" }
  | { kind: "unavailable" };

/** Login identity -> canonical person. Only active staff resolve. */
export async function loadStaffRecord(
  supabase: PlatformQueryClient,
  authUserId: string,
): Promise<StaffLookupResult> {
  const identity = await supabase
    .from("staff_identities")
    .select("staff_id")
    .eq("auth_user_id", authUserId)
    .eq("identity_type", "app_auth")
    .limit(1)
    .maybeSingle();

  if (identity.error) {
    return isMissingRelation(identity.error)
      ? { kind: "unavailable" }
      : { kind: "unlinked" };
  }

  const staffId = (identity.data as { staff_id?: string } | null)?.staff_id;
  if (!staffId) return { kind: "unlinked" };

  const staffRow = await supabase
    .from("staff")
    .select(
      "staff_id, org_id, staff_no, name, employment_type, status, joined_at, left_at",
    )
    .eq("staff_id", staffId)
    .maybeSingle();

  if (staffRow.error || !staffRow.data) return { kind: "unlinked" };

  const row = staffRow.data as Record<string, unknown>;
  const employmentType = parseEmploymentType(row.employment_type);
  const status = parseStaffStatus(row.status);
  if (!employmentType || !status) return { kind: "unlinked" };

  const departments = await supabase
    .from("staff_departments")
    .select("department_id, is_primary")
    .eq("staff_id", staffId)
    .is("deleted_at", null);

  const deptRows = (departments.data ?? []) as Array<{
    department_id: string;
    is_primary: boolean;
  }>;

  return {
    kind: "found",
    staff: {
      staffId,
      organizationId: String(row.org_id),
      staffNo: String(row.staff_no),
      name: String(row.name),
      employmentType,
      status,
      joinedAt: (row.joined_at as string | null) ?? null,
      leftAt: (row.left_at as string | null) ?? null,
      departmentIds: deptRows.map((d) => d.department_id),
      primaryDepartmentId:
        deptRows.find((d) => d.is_primary)?.department_id ?? null,
    },
  };
}

/**
 * Role grants plus staff overrides for one organization.
 * Every query is filtered by `org_id`, so grants never cross a tenant boundary
 * even before RLS is consulted.
 */
export async function loadGrants(
  supabase: PlatformQueryClient,
  staff: Pick<StaffRecord, "staffId" | "organizationId">,
): Promise<{ grants: PermissionGrant[]; roleIds: string[] }> {
  const assignments = await supabase
    .from("staff_role_assignments")
    .select(
      "role_id, scope_type, scope_id, roles ( id, deleted_at, role_permissions ( deleted_at, permissions ( key, deleted_at ) ) )",
    )
    .eq("staff_id", staff.staffId)
    .eq("org_id", staff.organizationId)
    .is("deleted_at", null);

  const grants: PermissionGrant[] = [];
  const roleIds: string[] = [];

  type AssignmentRow = {
    role_id: string;
    scope_type: string;
    scope_id: string | null;
    roles: { id: string; deleted_at: string | null; role_permissions: unknown } | null;
  };

  for (const raw of (assignments.data ?? []) as AssignmentRow[]) {
    if (!raw.roles || raw.roles.deleted_at) continue;
    const scope = parseScope(raw.scope_type, raw.scope_id, staff.staffId);
    if (!scope) continue;
    if (!roleIds.includes(raw.role_id)) roleIds.push(raw.role_id);

    for (const key of collectPermissionKeys(raw.roles.role_permissions)) {
      if (!isPlatformPermission(key)) continue;
      grants.push({
        permission: key,
        scope,
        effect: "allow",
        source: "role",
        roleId: raw.role_id,
      });
    }
  }

  const overrides = await supabase
    .from("staff_permission_overrides")
    .select("effect, scope_type, scope_id, permissions ( key, deleted_at )")
    .eq("staff_id", staff.staffId)
    .eq("org_id", staff.organizationId)
    .is("deleted_at", null);

  type OverrideRow = {
    effect: string;
    scope_type: string;
    scope_id: string | null;
    permissions: NestedPermission;
  };

  for (const raw of (overrides.data ?? []) as OverrideRow[]) {
    const perm = raw.permissions;
    if (!perm || perm.deleted_at) continue;
    if (!isPlatformPermission(perm.key)) continue;
    const scope = parseScope(raw.scope_type, raw.scope_id, staff.staffId);
    if (!scope) continue;
    grants.push({
      permission: perm.key,
      scope,
      effect: raw.effect === "deny" ? "deny" : "allow",
      source: "override",
      roleId: null,
    });
  }

  return { grants, roleIds };
}
