import "server-only";
import { CURRENT_MEMBERSHIP } from "@/lib/data/dev-sample/memberships";
import { isDevSampleMode } from "./env";
import { createServerSupabaseClient } from "./server";
import {
  loadLiveMembership,
  type LiveMembership,
  type RegaproSupabaseClient,
} from "./membership";
import {
  buildAccessContextFromMembership,
  buildAccessContextFromStaff,
  type SessionAccessBundle,
} from "./access-context";
import { decideLoginAdmission } from "./session-admission";
import {
  loadGrants,
  loadStaffRecord,
  type PlatformQueryClient,
} from "@/lib/platform/staff-queries";
import { withLegacyCompatibilityGrants } from "@regapro/platform";
import { distinctScopes } from "@regapro/security";

export type SessionUser = {
  id: string;
  email: string;
  displayName: string;
};

export async function getSessionUser(): Promise<SessionUser | null> {
  if (isDevSampleMode()) {
    return {
      id: CURRENT_MEMBERSHIP.userId,
      email: CURRENT_MEMBERSHIP.email,
      displayName: CURRENT_MEMBERSHIP.name,
    };
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return null;
  }

  const { data: profileData } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("user_id", data.user.id)
    .is("deleted_at", null)
    .maybeSingle();

  const profile = profileData as { display_name?: string } | null;

  return {
    id: data.user.id,
    email: data.user.email ?? "",
    displayName:
      profile?.display_name ||
      data.user.email?.split("@")[0] ||
      "利用者",
  };
}

export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    throw new Error("UNAUTHENTICATED");
  }
  return user;
}

export type SessionAccessOptions = {
  threadLevel?: SessionAccessBundle["access"]["threadConfidentialityLevel"];
  threadVisibility?: SessionAccessBundle["access"]["threadVisibility"];
  participantThreadIds?: string[];
  projectIds?: string[];
  auditMode?: boolean;
  auditCaseId?: string | null;
};

/**
 * Current user + AccessContext.
 * Succeeds for a usable AI membership OR an active staff-only identity.
 */
export async function getSessionAccess(
  opts?: SessionAccessOptions,
): Promise<SessionAccessBundle | null> {
  if (isDevSampleMode()) {
    return null;
  }

  const supabase = (await createServerSupabaseClient()) as unknown as RegaproSupabaseClient;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return null;
  }

  const membership = await loadLiveMembership(supabase, data.user.id);
  const platformClient = supabase as unknown as PlatformQueryClient;
  const staffLookup = await loadStaffRecord(platformClient, data.user.id);
  const admission = decideLoginAdmission({ membership, staff: staffLookup });
  if (!admission.ok) {
    return null;
  }

  const email = data.user.email ?? "";
  const displayName =
    membership?.displayName ||
    (staffLookup.kind === "found" ? staffLookup.staff.name : null) ||
    data.user.email?.split("@")[0] ||
    "利用者";

  if (admission.kind === "legacy_membership") {
    const bundle = buildAccessContextFromMembership(admission.membership, opts);
    if (staffLookup.kind === "found") {
      const { grants, roleIds } = await loadGrants(platformClient, staffLookup.staff);
      bundle.access = {
        ...bundle.access,
        authUserId: data.user.id,
        staffId: staffLookup.staff.staffId,
        staffNo: staffLookup.staff.staffNo,
        employmentType: staffLookup.staff.employmentType,
        staffStatus: staffLookup.staff.status,
        departmentIds:
          staffLookup.staff.departmentIds.length > 0
            ? staffLookup.staff.departmentIds
            : bundle.access.departmentIds,
        roleIds,
        permissions: grants,
        scopes: distinctScopes(grants),
      };
    } else {
      bundle.access = withLegacyCompatibilityGrants(bundle.access);
    }
    return bundle;
  }

  const { grants, roleIds } = await loadGrants(platformClient, admission.staff);
  return buildAccessContextFromStaff({
    userId: data.user.id,
    email,
    displayName,
    staff: admission.staff,
    grants,
    roleIds,
    opts,
  });
}

export async function requireSessionAccess(
  opts?: SessionAccessOptions,
): Promise<SessionAccessBundle> {
  const bundle = await getSessionAccess(opts);
  if (!bundle) {
    throw new Error("NO_ORGANIZATION_MEMBERSHIP");
  }
  return bundle;
}

export type { LiveMembership, SessionAccessBundle };
