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
  type SessionAccessBundle,
} from "./access-context";

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

/**
 * Current user + live membership + AccessContext.
 * Returns null when unauthenticated or when the user has no org membership.
 */
export async function getSessionAccess(opts?: {
  threadLevel?: SessionAccessBundle["access"]["threadConfidentialityLevel"];
  threadVisibility?: SessionAccessBundle["access"]["threadVisibility"];
  participantThreadIds?: string[];
  projectIds?: string[];
  auditMode?: boolean;
  auditCaseId?: string | null;
}): Promise<SessionAccessBundle | null> {
  if (isDevSampleMode()) {
    return null;
  }

  const supabase = (await createServerSupabaseClient()) as unknown as RegaproSupabaseClient;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return null;
  }

  const membership = await loadLiveMembership(supabase, data.user.id);
  if (!membership) {
    return null;
  }

  return buildAccessContextFromMembership(membership, opts);
}

export async function requireSessionAccess(
  opts?: Parameters<typeof getSessionAccess>[0],
): Promise<SessionAccessBundle> {
  const bundle = await getSessionAccess(opts);
  if (!bundle) {
    throw new Error("NO_ORGANIZATION_MEMBERSHIP");
  }
  return bundle;
}

export type { LiveMembership, SessionAccessBundle };
