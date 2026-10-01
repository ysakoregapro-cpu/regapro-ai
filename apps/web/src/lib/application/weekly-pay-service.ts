import "server-only";
import { staffFieldsOf, type AccessContext } from "@regapro/security";
import { hasPermission } from "@regapro/platform";
import {
  WeeklyPayDomainError,
  approveWeeklyApplication as approveWeeklyApplicationUseCase,
  cancelPaymentBatch as cancelPaymentBatchUseCase,
  createOrReplaceWeeklyApplicationDraft as createOrReplaceWeeklyApplicationDraftUseCase,
  createPaymentBatch as createPaymentBatchUseCase,
  deactivateBankAccount as deactivateBankAccountUseCase,
  downloadPaymentBatchCsv as downloadPaymentBatchCsvUseCase,
  getApplicationBankSnapshot as getApplicationBankSnapshotUseCase,
  getPaymentBatch as getPaymentBatchUseCase,
  getTransferorSettings as getTransferorSettingsUseCase,
  getWeeklyApplication as getWeeklyApplicationUseCase,
  getWorkerSettings as getWorkerSettingsUseCase,
  listBankAccountsMasked as listBankAccountsMaskedUseCase,
  listPaymentBatches as listPaymentBatchesUseCase,
  listSettlementLedger as listSettlementLedgerUseCase,
  listWeeklyApplications as listWeeklyApplicationsUseCase,
  listWeeklyPayPolicies as listWeeklyPayPoliciesUseCase,
  recordPaymentBatchBankSubmission as recordPaymentBatchBankSubmissionUseCase,
  recordPaymentBatchItemResults as recordPaymentBatchItemResultsUseCase,
  resolveUnknownPaymentItem as resolveUnknownPaymentItemUseCase,
  returnWeeklyApplication as returnWeeklyApplicationUseCase,
  submitWeeklyApplication as submitWeeklyApplicationUseCase,
  upsertBankAccount as upsertBankAccountUseCase,
  upsertTransferorSettings as upsertTransferorSettingsUseCase,
  upsertWeeklyPayPolicy as upsertWeeklyPayPolicyUseCase,
  upsertWorkerSettings as upsertWorkerSettingsUseCase,
  type CreateWeeklyApplicationDraftInput,
  type CreateWeeklyPayPaymentBatchInput,
  type UpsertBankAccountInput,
  type UpsertWorkerSettingsInput,
  type WeeklyApplicationListQuery,
  type WeeklyPayActor,
  type WeeklyPayItemResultInput,
  type WeeklyPayTransferorUpsertInput,
} from "@regapro/work";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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

async function ports(opts?: { withService?: boolean }) {
  const client = (await createServerSupabaseClient()) as unknown as Parameters<
    typeof createSupabaseWeeklyPayPorts
  >[0];
  if (!opts?.withService) return createSupabaseWeeklyPayPorts(client);
  const serviceClient = createAdminClient() as unknown as Parameters<
    typeof createSupabaseWeeklyPayPorts
  >[0];
  return createSupabaseWeeklyPayPorts(client, { serviceClient });
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

export async function listBankAccountsForAccess(access: AccessContext, staffId?: string) {
  return listBankAccountsMaskedUseCase(await ports(), actorFromAccess(access), staffId);
}

export async function upsertBankAccountForAccess(
  access: AccessContext,
  input: UpsertBankAccountInput,
) {
  return upsertBankAccountUseCase(await ports(), actorFromAccess(access), input);
}

export async function deactivateBankAccountForAccess(
  access: AccessContext,
  bankAccountId: string,
) {
  return deactivateBankAccountUseCase(await ports(), actorFromAccess(access), bankAccountId);
}

export async function getWorkerSettingsForAccess(access: AccessContext, staffId?: string) {
  return getWorkerSettingsUseCase(await ports(), actorFromAccess(access), staffId);
}

export async function upsertWorkerSettingsForAccess(
  access: AccessContext,
  input: UpsertWorkerSettingsInput,
) {
  return upsertWorkerSettingsUseCase(await ports(), actorFromAccess(access), input);
}

export async function getApplicationBankSnapshotForAccess(
  access: AccessContext,
  applicationId: string,
) {
  return getApplicationBankSnapshotUseCase(await ports(), actorFromAccess(access), applicationId);
}

export async function getTransferorSettingsForAccess(access: AccessContext) {
  return getTransferorSettingsUseCase(await ports(), actorFromAccess(access));
}

export async function upsertTransferorSettingsForAccess(
  access: AccessContext,
  input: WeeklyPayTransferorUpsertInput,
) {
  return upsertTransferorSettingsUseCase(await ports(), actorFromAccess(access), input);
}

export async function listPaymentBatchesForAccess(access: AccessContext) {
  return listPaymentBatchesUseCase(await ports(), actorFromAccess(access));
}

export async function getPaymentBatchForAccess(access: AccessContext, batchId: string) {
  return getPaymentBatchUseCase(await ports(), actorFromAccess(access), batchId);
}

export async function createPaymentBatchForAccess(
  access: AccessContext,
  input: CreateWeeklyPayPaymentBatchInput,
) {
  return createPaymentBatchUseCase(await ports(), actorFromAccess(access), input);
}

export async function cancelPaymentBatchForAccess(
  access: AccessContext,
  batchId: string,
  reason: string,
) {
  return cancelPaymentBatchUseCase(await ports(), actorFromAccess(access), batchId, reason);
}

export async function recordBankSubmissionForAccess(
  access: AccessContext,
  batchId: string,
  note?: string | null,
  bankFileRef?: string | null,
) {
  return recordPaymentBatchBankSubmissionUseCase(
    await ports(),
    actorFromAccess(access),
    batchId,
    note,
    bankFileRef,
  );
}

export async function recordItemResultsForAccess(
  access: AccessContext,
  batchId: string,
  results: WeeklyPayItemResultInput[],
) {
  return recordPaymentBatchItemResultsUseCase(
    await ports(),
    actorFromAccess(access),
    batchId,
    results,
  );
}

export async function resolveUnknownItemForAccess(
  access: AccessContext,
  itemId: string,
  outcome: "failed" | "cancelled",
  reason?: string | null,
) {
  return resolveUnknownPaymentItemUseCase(
    await ports(),
    actorFromAccess(access),
    itemId,
    outcome,
    reason,
  );
}

export async function listSettlementLedgerForAccess(access: AccessContext, staffId?: string) {
  return listSettlementLedgerUseCase(await ports(), actorFromAccess(access), staffId);
}

export async function downloadPaymentBatchCsvForAccess(
  access: AccessContext,
  batchId: string,
) {
  return downloadPaymentBatchCsvUseCase(
    await ports({ withService: true }),
    actorFromAccess(access),
    batchId,
  );
}
