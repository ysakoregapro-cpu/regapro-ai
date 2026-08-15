import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

export const REGAPRO_ORG_SLUG = "regapro";
export const REGAPRO_ORG_NAME = "株式会社レガプロ";

export const REGAPRO_DEPARTMENTS = [
  { key: "sales", name: "営業部", defaultClearanceLevel: 1 },
  { key: "people", name: "人事部", defaultClearanceLevel: 2 },
  { key: "executive_strategy", name: "経営戦略部", defaultClearanceLevel: 3 },
] as const;

export type BootstrapAdminInput = {
  /** Auth user uuid — preferred when known. */
  userId?: string;
  /** Auth user email — resolved via admin Auth API. */
  email?: string;
  displayName?: string;
  /** Department key for the admin membership (default executive_strategy). */
  departmentKey?: (typeof REGAPRO_DEPARTMENTS)[number]["key"];
  roleKey?: "admin" | "manager" | "editor" | "member";
};

export type BootstrapResult = {
  organizationId: string;
  departments: Array<{ id: string; key: string; name: string; created: boolean }>;
  admin?: {
    userId: string;
    membershipId: string;
    roleId: string;
    createdMembership: boolean;
    createdProfile: boolean;
  };
};

/**
 * Idempotent org + department bootstrap (service-role).
 * Does not create Auth users — pass an existing email or user id to attach admin.
 */
export async function bootstrapRegaproOrganization(
  admin: SupabaseClient<Database>,
  options?: { adminUser?: BootstrapAdminInput },
): Promise<BootstrapResult> {
  const { data: existingOrg } = await admin
    .from("organizations")
    .select("id")
    .eq("slug", REGAPRO_ORG_SLUG)
    .is("deleted_at", null)
    .maybeSingle();

  let organizationId: string;
  if (existingOrg?.id) {
    organizationId = existingOrg.id;
    await admin
      .from("organizations")
      .update({ name: REGAPRO_ORG_NAME, updated_at: new Date().toISOString() })
      .eq("id", organizationId);
  } else {
    const { data: created, error } = await admin
      .from("organizations")
      .insert({ name: REGAPRO_ORG_NAME, slug: REGAPRO_ORG_SLUG })
      .select("id")
      .single();
    if (error || !created) {
      throw new Error(`Failed to create organization: ${error?.message}`);
    }
    organizationId = created.id;
  }

  const departments: BootstrapResult["departments"] = [];
  for (const dept of REGAPRO_DEPARTMENTS) {
    const { data: existingDept } = await admin
      .from("departments")
      .select("id")
      .eq("org_id", organizationId)
      .eq("key", dept.key)
      .is("deleted_at", null)
      .maybeSingle();

    if (existingDept?.id) {
      await admin
        .from("departments")
        .update({
          name: dept.name,
          default_clearance_level: dept.defaultClearanceLevel,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingDept.id);
      departments.push({
        id: existingDept.id,
        key: dept.key,
        name: dept.name,
        created: false,
      });
    } else {
      const { data: createdDept, error } = await admin
        .from("departments")
        .insert({
          org_id: organizationId,
          key: dept.key,
          name: dept.name,
          default_clearance_level: dept.defaultClearanceLevel,
        })
        .select("id")
        .single();
      if (error || !createdDept) {
        throw new Error(`Failed to create department ${dept.key}: ${error?.message}`);
      }
      departments.push({
        id: createdDept.id,
        key: dept.key,
        name: dept.name,
        created: true,
      });
    }
  }

  const result: BootstrapResult = { organizationId, departments };

  const adminUser = options?.adminUser;
  if (!adminUser?.email && !adminUser?.userId) {
    return result;
  }

  let userId = adminUser.userId ?? null;
  let email = adminUser.email ?? null;

  if (!userId && email) {
    const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listed.error) {
      throw new Error(`Failed to list auth users: ${listed.error.message}`);
    }
    const found = listed.data.users.find(
      (u) => u.email?.toLowerCase() === email!.toLowerCase(),
    );
    if (!found) {
      throw new Error(
        `No Auth user found for email "${email}". Create the user in Supabase Auth first, then re-run with --admin-email or --admin-user-id.`,
      );
    }
    userId = found.id;
    email = found.email ?? email;
  }

  if (userId && !email) {
    const { data: userData, error } = await admin.auth.admin.getUserById(userId);
    if (error || !userData.user) {
      throw new Error(
        `No Auth user found for id "${userId}". Create the user in Supabase Auth first.`,
      );
    }
    email = userData.user.email ?? null;
  }

  if (!userId) {
    throw new Error("Admin user id could not be resolved.");
  }

  const displayName =
    adminUser.displayName ||
    email?.split("@")[0] ||
    "管理者";

  const { data: existingProfile } = await admin
    .from("profiles")
    .select("id")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();

  let createdProfile = false;
  if (existingProfile?.id) {
    await admin
      .from("profiles")
      .update({
        display_name: displayName,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingProfile.id);
  } else {
    const { error } = await admin.from("profiles").insert({
      user_id: userId,
      display_name: displayName,
    });
    if (error) {
      throw new Error(`Failed to create profile: ${error.message}`);
    }
    createdProfile = true;
  }

  const deptKey = adminUser.departmentKey ?? "executive_strategy";
  const department = departments.find((d) => d.key === deptKey);
  if (!department) {
    throw new Error(`Department ${deptKey} missing after bootstrap.`);
  }

  const roleKey = adminUser.roleKey ?? "admin";
  const { data: role, error: roleError } = await admin
    .from("roles")
    .select("id")
    .eq("key", roleKey)
    .is("org_id", null)
    .is("deleted_at", null)
    .maybeSingle();
  if (roleError || !role) {
    throw new Error(`Template role "${roleKey}" not found (seed roles).`);
  }

  const { data: existingMembership } = await admin
    .from("organization_memberships")
    .select("id")
    .eq("org_id", organizationId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();

  let membershipId: string;
  let createdMembership = false;
  if (existingMembership?.id) {
    membershipId = existingMembership.id;
    await admin
      .from("organization_memberships")
      .update({
        department_id: department.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", membershipId);
  } else {
    const { data: createdMem, error } = await admin
      .from("organization_memberships")
      .insert({
        org_id: organizationId,
        user_id: userId,
        department_id: department.id,
      })
      .select("id")
      .single();
    if (error || !createdMem) {
      throw new Error(`Failed to create membership: ${error?.message}`);
    }
    membershipId = createdMem.id;
    createdMembership = true;
  }

  const { data: existingMr } = await admin
    .from("membership_roles")
    .select("id")
    .eq("membership_id", membershipId)
    .eq("role_id", role.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!existingMr) {
    const { error } = await admin.from("membership_roles").insert({
      membership_id: membershipId,
      role_id: role.id,
    });
    if (error) {
      throw new Error(`Failed to assign role: ${error.message}`);
    }
  }

  result.admin = {
    userId,
    membershipId,
    roleId: role.id,
    createdMembership,
    createdProfile,
  };

  return result;
}
