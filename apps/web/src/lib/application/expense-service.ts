import "server-only";
import { staffFieldsOf, type AccessContext } from "@regapro/security";
import { hasPermission } from "@regapro/platform";
import {
  ExpenseDomainError,
  approveExpenseApplication as approveExpenseApplicationUseCase,
  attachExpenseReceipt as attachExpenseReceiptUseCase,
  listExpenseApplications as listExpenseApplicationsUseCase,
  listExpenseCategories as listExpenseCategoriesUseCase,
  returnExpenseApplication as returnExpenseApplicationUseCase,
  submitExpenseApplication as submitExpenseApplicationUseCase,
  upsertExpenseApplicationDraft as upsertExpenseApplicationDraftUseCase,
  type ExpenseActor,
  type ExpenseApplicationListQuery,
  type UpsertExpenseApplicationDraftInput,
} from "@regapro/work";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createSupabaseExpensePorts } from "@/lib/data/persistence/supabase-expense";

function actorFromAccess(access: AccessContext): ExpenseActor {
  const staff = staffFieldsOf(access);
  if (!staff.staffId || staff.staffStatus !== "active") {
    throw new ExpenseDomainError("FORBIDDEN", "active staff identity is required");
  }
  const permissions: Array<ExpenseActor["permissions"][number]> = [];
  for (const key of ["expense.submit", "expense.view_own", "expense.manage"] as const) {
    if (hasPermission(access, key)) permissions.push(key);
  }
  return { staffId: staff.staffId, orgId: access.organizationId, permissions };
}

async function ports() {
  const client = (await createServerSupabaseClient()) as unknown as Parameters<
    typeof createSupabaseExpensePorts
  >[0];
  return createSupabaseExpensePorts(client);
}

export async function listExpenseCategoriesForAccess(access: AccessContext) {
  return listExpenseCategoriesUseCase(await ports(), actorFromAccess(access));
}

export async function listExpenseApplicationsForAccess(
  access: AccessContext,
  query: ExpenseApplicationListQuery,
) {
  return listExpenseApplicationsUseCase(await ports(), actorFromAccess(access), query);
}

export async function upsertExpenseApplicationDraftForAccess(
  access: AccessContext,
  input: UpsertExpenseApplicationDraftInput,
) {
  return upsertExpenseApplicationDraftUseCase(await ports(), actorFromAccess(access), input);
}

export async function submitExpenseApplicationForAccess(
  access: AccessContext,
  applicationId: string,
) {
  return submitExpenseApplicationUseCase(await ports(), actorFromAccess(access), applicationId);
}

export async function returnExpenseApplicationForAccess(
  access: AccessContext,
  applicationId: string,
  reason: string,
) {
  return returnExpenseApplicationUseCase(
    await ports(),
    actorFromAccess(access),
    applicationId,
    reason,
  );
}

export async function approveExpenseApplicationForAccess(
  access: AccessContext,
  applicationId: string,
) {
  return approveExpenseApplicationUseCase(await ports(), actorFromAccess(access), applicationId);
}

export async function attachExpenseReceiptForAccess(
  access: AccessContext,
  applicationId: string,
  fileObjectId: string,
) {
  return attachExpenseReceiptUseCase(await ports(), actorFromAccess(access), {
    applicationId,
    fileObjectId,
  });
}
