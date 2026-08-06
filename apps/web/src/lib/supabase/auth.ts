import { createClient } from "./server";
import { isDevSampleMode } from "./env";

export type SessionUser = {
  id: string;
  email: string;
  displayName: string;
};

export async function getSessionUser(): Promise<SessionUser | null> {
  if (isDevSampleMode()) {
    return {
      id: "00000000-0000-4000-8000-000000000001",
      email: "tanaka@regapro.example",
      displayName: "田中 健太",
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
