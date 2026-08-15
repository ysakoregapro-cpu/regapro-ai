import "server-only";
import type {
  ConfidentialityLevel,
  DepartmentKey,
  Permission,
  Role,
} from "@regapro/shared";
import {
  DEPARTMENT_KEYS,
  DEPARTMENT_LABELS,
  ConfidentialityLevelSchema,
  ROLES,
  confidentialityFromRank,
} from "@regapro/shared";
import { listEffectivePermissions } from "@regapro/security";
import type { User } from "@supabase/supabase-js";
import type { LiveMembership } from "./membership-types";

export type { LiveMembership } from "./membership-types";

type MembershipRow = {
  id: string;
  org_id: string;
  user_id: string;
  department_id: string | null;
  clearance_override: number | null;
  organizations: { id: string; name: string } | null;
  departments: {
    id: string;
    key: string | null;
    name: string;
    default_clearance_level: number;
  } | null;
  membership_roles: Array<{
    deleted_at: string | null;
    roles: { key: string; deleted_at: string | null } | null;
  }> | null;
};

type ThenableQuery<T> = {
  then: PromiseLike<{ data: T; error: { message: string } | null }>["then"];
};

type PostgrestLike = {
  select: (columns: string) => PostgrestLike;
  eq: (column: string, value: string) => PostgrestLike;
  is: (column: string, value: null) => PostgrestLike;
  in: (column: string, values: readonly string[]) => PostgrestLike;
  limit: (count: number) => PostgrestLike;
  maybeSingle: () => PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

/**
 * Structural client type — avoids SupabaseClient generic arity mismatch between
 * @supabase/ssr and @supabase/supabase-js.
 */
export type RegaproSupabaseClient = {
  auth: {
    getUser: () => PromiseLike<{
      data: { user: User | null };
      error: { message: string } | null;
    }>;
  };
  from: (relation: string) => PostgrestLike;
};

function parseDepartmentKey(raw: string | null | undefined): DepartmentKey | null {
  if (!raw) return null;
  return (DEPARTMENT_KEYS as readonly string[]).includes(raw)
    ? (raw as DepartmentKey)
    : null;
}

function parseRole(raw: string): Role | null {
  return (ROLES as readonly string[]).includes(raw) ? (raw as Role) : null;
}

function parseClearanceOverride(
  rank: number | null,
): ConfidentialityLevel | null {
  if (rank === null || rank === undefined) return null;
  if (rank < 1 || rank > 3) return null;
  return ConfidentialityLevelSchema.parse(confidentialityFromRank(rank));
}

/**
 * Loads active organization membership + roles for a user (RLS as caller).
 * Returns null when the user has no usable membership — do not admit to org data.
 */
export async function loadLiveMembership(
  supabase: RegaproSupabaseClient,
  userId: string,
): Promise<LiveMembership | null> {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user || authData.user.id !== userId) {
    return null;
  }

  const { data, error } = await supabase
    .from("organization_memberships")
    .select(
      `
      id,
      org_id,
      user_id,
      department_id,
      clearance_override,
      organizations ( id, name ),
      departments ( id, key, name, default_clearance_level ),
      membership_roles ( deleted_at, roles ( key, deleted_at ) )
    `,
    )
    .eq("user_id", userId)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const row = data as MembershipRow;
  const deptKey = parseDepartmentKey(row.departments?.key);
  if (!deptKey) {
    return null;
  }

  const roles = (row.membership_roles ?? [])
    .filter((mr) => mr.deleted_at === null && mr.roles && !mr.roles.deleted_at)
    .map((mr) => parseRole(mr.roles!.key))
    .filter((r): r is Role => r !== null);

  if (roles.length === 0) {
    return null;
  }

  const roleQuery = supabase
    .from("roles")
    .select("id, key")
    .in("key", roles)
    .is("deleted_at", null) as unknown as ThenableQuery<
    Array<{ id: string; key: string }> | null
  >;
  const { data: roleIdRows } = await roleQuery;
  const roleIds = (roleIdRows ?? []).map((r) => r.id);

  const dbPermissionKeys: Permission[] = [];
  if (roleIds.length > 0) {
    const permQuery = supabase
      .from("role_permissions")
      .select("permissions ( key, deleted_at )")
      .in("role_id", roleIds)
      .is("deleted_at", null) as unknown as ThenableQuery<
      Array<{
        permissions: { key: string; deleted_at: string | null } | null;
      }> | null
    >;
    const { data: rpRows } = await permQuery;
    for (const rp of rpRows ?? []) {
      const perm = rp.permissions;
      if (!perm || perm.deleted_at) continue;
      const key = perm.key as Permission;
      if (!dbPermissionKeys.includes(key)) dbPermissionKeys.push(key);
    }
  }

  const templatePermissions = listEffectivePermissions({ roles });
  const permissionKeys = Array.from(
    new Set([...templatePermissions, ...dbPermissionKeys]),
  ) as Permission[];

  const clearanceOverride = parseClearanceOverride(row.clearance_override);
  const defaultRank = (row.departments?.default_clearance_level ?? 1) as
    | 1
    | 2
    | 3;
  const effectiveClearanceRank = (clearanceOverride
    ? ({ company: 1, people: 2, executive: 3 } as const)[clearanceOverride]
    : defaultRank) as 1 | 2 | 3;

  const { data: profileData } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();

  const profile = profileData as { display_name: string } | null;

  return {
    userId,
    email: authData.user.email ?? "",
    displayName:
      profile?.display_name ||
      authData.user.email?.split("@")[0] ||
      "利用者",
    organizationId: row.org_id,
    organizationName: row.organizations?.name ?? "",
    membershipId: row.id,
    departmentId: row.department_id,
    departmentKey: deptKey,
    departmentLabel: row.departments?.name ?? DEPARTMENT_LABELS[deptKey],
    roles,
    permissionKeys,
    clearanceOverride,
    effectiveClearanceRank,
  };
}
