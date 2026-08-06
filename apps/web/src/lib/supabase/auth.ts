import { CURRENT_MEMBERSHIP } from "@/lib/data/dev-sample/memberships";
import { isDevSampleMode } from "./env";
import { createClient } from "./server";

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

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) {
    return null;
  }

  const sub = String(data.claims.sub ?? "");
  const email = String(data.claims.email ?? "");
  return {
    id: sub,
    email,
    displayName: email.split("@")[0] || "利用者",
  };
}

export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    throw new Error("UNAUTHENTICATED");
  }
  return user;
}
