import "server-only";
import { selectableLevelsForClearance } from "@regapro/shared";
import { isDevSampleMode } from "@/lib/supabase/env";
import { requireSessionAccess, type SessionAccessBundle } from "@/lib/supabase/auth";
import {
  resolveSessionAccess,
  type SampleMembership,
} from "@/lib/data/dev-sample/memberships";
import type { AccessContext } from "@regapro/security";
import type { ConfidentialityLevel } from "@regapro/shared";

/** Unified session shape for application services (dev-sample + live). */
export type AppSession = {
  membership: {
    userId: string;
    email: string;
    name: string;
    organizationId: string;
    membershipId: string;
    departmentId: string | null;
    departmentKey: SampleMembership["departmentKey"];
    departmentLabel: string;
    role: SampleMembership["role"];
  };
  access: AccessContext;
  maximumConfidentialityLevel: ConfidentialityLevel;
  selectableLevels: ConfidentialityLevel[];
  permissions: SessionAccessBundle["permissions"] | ReturnType<
    typeof resolveSessionAccess
  >["permissions"];
};

export function resolveAppSessionSync(opts?: { userId?: string }): AppSession {
  if (!isDevSampleMode()) {
    throw new Error(
      "resolveAppSessionSync is only for REGAPRO_DATA_MODE=dev-sample",
    );
  }
  const s = resolveSessionAccess(opts);
  return {
    membership: {
      userId: s.membership.userId,
      email: s.membership.email,
      name: s.membership.name,
      organizationId: s.membership.organizationId,
      membershipId: s.membership.membershipId,
      departmentId: s.membership.departmentId,
      departmentKey: s.membership.departmentKey,
      departmentLabel: s.membership.departmentLabel,
      role: s.membership.role,
    },
    access: s.access,
    maximumConfidentialityLevel: s.maximumConfidentialityLevel,
    selectableLevels: s.selectableLevels,
    permissions: s.permissions,
  };
}

export async function resolveAppSession(opts?: {
  userId?: string;
  threadLevel?: ConfidentialityLevel;
}): Promise<AppSession> {
  if (isDevSampleMode()) {
    return resolveAppSessionSync(opts);
  }

  const bundle = await requireSessionAccess({
    threadLevel: opts?.threadLevel,
  });
  const primaryRole = bundle.membership.roles[0] ?? "member";
  return {
    membership: {
      userId: bundle.membership.userId,
      email: bundle.membership.email,
      name: bundle.membership.displayName,
      organizationId: bundle.membership.organizationId,
      membershipId: bundle.membership.membershipId,
      departmentId: bundle.membership.departmentId,
      departmentKey: bundle.membership.departmentKey,
      departmentLabel: bundle.membership.departmentLabel,
      role: primaryRole,
    },
    access: bundle.access,
    maximumConfidentialityLevel: bundle.maximumConfidentialityLevel,
    selectableLevels: selectableLevelsForClearance(
      bundle.maximumConfidentialityLevel,
    ),
    permissions: bundle.permissions,
  };
}
