import "server-only";
import { staffFieldsOf, type AccessContext } from "@regapro/security";
import { hasPermission } from "@regapro/platform";
import {
  SalesDomainError,
  approveAllocationRule as approveAllocationRuleUseCase,
  correctPersonalSalesCase as correctPersonalSalesCaseUseCase,
  createPersonalSalesCase as createPersonalSalesCaseUseCase,
  listAllocationRuleVersions as listAllocationRuleVersionsUseCase,
  listPersonalSalesCases as listPersonalSalesCasesUseCase,
  revokeAllocationRule as revokeAllocationRuleUseCase,
  upsertAllocationRuleDraft as upsertAllocationRuleDraftUseCase,
  voidPersonalSalesCase as voidPersonalSalesCaseUseCase,
  type CreatePersonalSalesCaseInput,
  type CorrectPersonalSalesCaseInput,
  type PersonalSalesCaseListQuery,
  type SalesActor,
  type UpsertAllocationRuleDraftInput,
} from "@regapro/work";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createSupabaseSalesPorts } from "@/lib/data/persistence/supabase-sales";

function actorFromAccess(access: AccessContext): SalesActor {
  const staff = staffFieldsOf(access);
  if (!staff.staffId || staff.staffStatus !== "active") {
    throw new SalesDomainError("FORBIDDEN", "active staff identity is required");
  }
  const permissions: Array<SalesActor["permissions"][number]> = [];
  for (const key of ["sales.view_own", "sales.manage"] as const) {
    if (hasPermission(access, key)) permissions.push(key);
  }
  return { staffId: staff.staffId, orgId: access.organizationId, permissions };
}

async function ports() {
  const client = (await createServerSupabaseClient()) as unknown as Parameters<
    typeof createSupabaseSalesPorts
  >[0];
  return createSupabaseSalesPorts(client);
}

export async function listPersonalSalesCasesForAccess(
  access: AccessContext,
  query: PersonalSalesCaseListQuery,
) {
  return listPersonalSalesCasesUseCase(await ports(), actorFromAccess(access), query);
}

export async function createPersonalSalesCaseForAccess(
  access: AccessContext,
  input: CreatePersonalSalesCaseInput,
) {
  return createPersonalSalesCaseUseCase(await ports(), actorFromAccess(access), input);
}

export async function voidPersonalSalesCaseForAccess(
  access: AccessContext,
  caseId: string,
  reason: string,
) {
  return voidPersonalSalesCaseUseCase(await ports(), actorFromAccess(access), caseId, reason);
}

export async function correctPersonalSalesCaseForAccess(
  access: AccessContext,
  input: CorrectPersonalSalesCaseInput,
) {
  return correctPersonalSalesCaseUseCase(await ports(), actorFromAccess(access), input);
}

export async function listAllocationRulesForAccess(access: AccessContext) {
  return listAllocationRuleVersionsUseCase(await ports(), actorFromAccess(access));
}

export async function upsertAllocationRuleDraftForAccess(
  access: AccessContext,
  input: UpsertAllocationRuleDraftInput,
) {
  return upsertAllocationRuleDraftUseCase(await ports(), actorFromAccess(access), input);
}

export async function approveAllocationRuleForAccess(
  access: AccessContext,
  ruleVersionId: string,
) {
  return approveAllocationRuleUseCase(await ports(), actorFromAccess(access), ruleVersionId);
}

export async function revokeAllocationRuleForAccess(
  access: AccessContext,
  ruleVersionId: string,
  reason: string,
) {
  return revokeAllocationRuleUseCase(
    await ports(),
    actorFromAccess(access),
    ruleVersionId,
    reason,
  );
}
