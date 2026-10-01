import "server-only";
import { staffFieldsOf, type AccessContext } from "@regapro/security";
import { hasPermission } from "@regapro/platform";
import {
  WeeklyPayDomainError,
  approveWeeklyApplication as approveWeeklyApplicationUseCase,
  createOrReplaceWeeklyApplicationDraft as createOrReplaceWeeklyApplicationDraftUseCase,
  getWeeklyApplication as getWeeklyApplicationUseCase,
  listWeeklyApplications as listWeeklyApplicationsUseCase,
  listWeeklyPayPolicies as listWeeklyPayPoliciesUseCase,
  returnWeeklyApplication as returnWeeklyApplicationUseCase,
  submitWeeklyApplication as submitWeeklyApplicationUseCase,
  upsertWeeklyPayPolicy as upsertWeeklyPayPolicyUseCase,
  type CreateWeeklyApplicationDraftInput,
  type WeeklyApplicationListQuery,
  type WeeklyPayActor,
} from "@regapro/work";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createSupabaseWeeklyPayPorts } from "@/lib/data/persistence/supabase-weekly-pay";

function actorFromAccess(access: AccessContext): WeeklyPayActor {
  const staff = staffFieldsOf(access);
  if (!staff.staffId || staff.staffStatus !== "active") {
    throw new WeeklyPayDomainError("FORBIDDEN", "active staff identity is required");
  }
  const permissions: Array<WeeklyPayActor["permissions"][number]> = [];
  for (const key of [
    "weekly_pay.submit",
    "weekly_pay.review",
    "weekly_pay.pay",
    "weekly_pay.manage",
    "weekly_pay.policy_manage",
  ] as const) {
    if (hasPermission(access, key)) permissions.push(key);
  }
  return {
    staffId: staff.staffId,
    orgId: access.organizationId,
    permissions,
  };
}

async function ports() {
  const client = (await createServerSupabaseClient()) as unknown as Parameters<
    typeof createSupabaseWeeklyPayPorts
  >[0];
  return createSupabaseWeeklyPayPorts(client);
}

export async function listWeeklyApplicationsForAccess(
  access: AccessContext,
  query: WeeklyApplicationListQuery,
) {
  return listWeeklyApplicationsUseCase(await ports(), actorFromAccess(access), query);
}

export async function getWeeklyApplicationForAccess(
  access: AccessContext,
  applicationId: string,
) {
  return getWeeklyApplicationUseCase(await ports(), actorFromAccess(access), applicationId);
}

export async function createWeeklyApplicationDraftForAccess(
  access: AccessContext,
  input: CreateWeeklyApplicationDraftInput,
) {
  return createOrReplaceWeeklyApplicationDraftUseCase(
    await ports(),
    actorFromAccess(access),
    input,
  );
}

export async function submitWeeklyApplicationForAccess(
  access: AccessContext,
  applicationId: string,
) {
  return submitWeeklyApplicationUseCase(await ports(), actorFromAccess(access), applicationId);
}

export async function returnWeeklyApplicationForAccess(
  access: AccessContext,
  applicationId: string,
  reason: string,
) {
  return returnWeeklyApplicationUseCase(
    await ports(),
    actorFromAccess(access),
    applicationId,
    reason,
  );
}

export async function approveWeeklyApplicationForAccess(
  access: AccessContext,
  applicationId: string,
) {
  return approveWeeklyApplicationUseCase(await ports(), actorFromAccess(access), applicationId);
}

export async function listWeeklyPayPoliciesForAccess(access: AccessContext) {
  return listWeeklyPayPoliciesUseCase(await ports(), actorFromAccess(access));
}

export async function upsertWeeklyPayPolicyForAccess(
  access: AccessContext,
  input: Parameters<typeof upsertWeeklyPayPolicyUseCase>[2],
) {
  return upsertWeeklyPayPolicyUseCase(await ports(), actorFromAccess(access), input);
}
