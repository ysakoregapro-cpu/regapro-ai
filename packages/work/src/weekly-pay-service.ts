import type { PlatformPermission } from "@regapro/shared";
import { WeeklyPayDomainError } from "./weekly-pay-errors.js";
import { assertNotSelfReview, assertReturnReason } from "./weekly-pay-lifecycle.js";
import type { WeeklyPayPorts } from "./weekly-pay-ports.js";
import { isJapaneseBankBusinessDay } from "./weekly-pay-business-day.js";
import { buildSmtbSogoCsvBuffer, toHalfWidthKatakanaForSmtb } from "./weekly-pay-smtb-csv.js";
import type {
  ApplicationBankSnapshotMasked,
  BankAccountMasked,
  CreateWeeklyApplicationDraftInput,
  CreateWeeklyPayPaymentBatchInput,
  UpsertBankAccountInput,
  UpsertWorkerSettingsInput,
  WeeklyApplication,
  WeeklyApplicationListQuery,
  WeeklyPayItemResultInput,
  WeeklyPayPaymentBatch,
  WeeklyPayPaymentBatchItemMasked,
  WeeklyPayPolicy,
  WeeklyPaySettlementLedgerEntry,
  WeeklyPayTransferorSettings,
  WeeklyPayTransferorUpsertInput,
  WorkerSettings,
} from "./weekly-pay-types.js";

export type WeeklyPayActor = {
  staffId: string;
  orgId: string;
  permissions: readonly PlatformPermission[];
};

function has(actor: WeeklyPayActor, permission: PlatformPermission): boolean {
  return actor.permissions.includes(permission);
}

function requireStaff(actor: WeeklyPayActor): void {
  if (!actor.staffId) {
    throw new WeeklyPayDomainError("FORBIDDEN", "staff identity is required");
  }
}

export function canSubmitWeeklyPay(actor: WeeklyPayActor): boolean {
  return has(actor, "weekly_pay.submit") || has(actor, "weekly_pay.manage");
}

export function canReviewWeeklyPay(actor: WeeklyPayActor): boolean {
  return has(actor, "weekly_pay.review") || has(actor, "weekly_pay.manage");
}

export function canManageWeeklyPay(actor: WeeklyPayActor): boolean {
  return has(actor, "weekly_pay.manage");
}

export function canManageWeeklyPayPolicy(actor: WeeklyPayActor): boolean {
  return has(actor, "weekly_pay.policy_manage");
}

export function canViewWeeklyPay(actor: WeeklyPayActor): boolean {
  return (
    canSubmitWeeklyPay(actor) ||
    canReviewWeeklyPay(actor) ||
    has(actor, "weekly_pay.pay") ||
    canManageWeeklyPayPolicy(actor)
  );
}

export function canPayWeeklyPay(actor: WeeklyPayActor): boolean {
  return has(actor, "weekly_pay.pay") || has(actor, "weekly_pay.manage");
}

export function canDecryptBankAccount(actor: WeeklyPayActor): boolean {
  return canPayWeeklyPay(actor);
}

export async function listWeeklyApplications(
  ports: WeeklyPayPorts,
  actor: WeeklyPayActor,
  query: WeeklyApplicationListQuery,
): Promise<WeeklyApplication[]> {
  requireStaff(actor);
  if (!canViewWeeklyPay(actor)) {
    throw new WeeklyPayDomainError("FORBIDDEN", "weekly_pay view permission required");
  }
  if (canReviewWeeklyPay(actor) || canManageWeeklyPay(actor) || has(actor, "weekly_pay.pay")) {
    return ports.applications.list(actor.orgId, query);
  }
  return ports.applications.list(actor.orgId, { ...query, staffId: actor.staffId });
}

export async function getWeeklyApplication(
  ports: WeeklyPayPorts,
  actor: WeeklyPayActor,
  applicationId: string,
): Promise<WeeklyApplication> {
  requireStaff(actor);
  if (!canViewWeeklyPay(actor)) {
    throw new WeeklyPayDomainError("FORBIDDEN", "weekly_pay view permission required");
  }
  const app = await ports.applications.getById(actor.orgId, applicationId);
  if (!app) {
    throw new WeeklyPayDomainError("NOT_FOUND", "weekly application");
  }
  if (
    app.staffId !== actor.staffId &&
    !canReviewWeeklyPay(actor) &&
    !canManageWeeklyPay(actor) &&
    !has(actor, "weekly_pay.pay")
  ) {
    throw new WeeklyPayDomainError("FORBIDDEN", "cannot read another staff weekly application");
  }
  return app;
}

export async function createOrReplaceWeeklyApplicationDraft(
  ports: WeeklyPayPorts,
  actor: WeeklyPayActor,
  input: CreateWeeklyApplicationDraftInput,
): Promise<WeeklyApplication> {
  requireStaff(actor);
  if (!canSubmitWeeklyPay(actor)) {
    throw new WeeklyPayDomainError("FORBIDDEN", "weekly_pay.submit required");
  }
  const target = input.staffId ?? actor.staffId;
  if (target !== actor.staffId && !canManageWeeklyPay(actor)) {
    throw new WeeklyPayDomainError(
      "FORBIDDEN",
      "cannot create weekly application for another staff",
    );
  }
  if (!input.workRecordIds?.length) {
    throw new WeeklyPayDomainError("INVALID_SELECTION", "no work records selected");
  }
  return ports.applications.createOrReplaceDraft(actor.orgId, {
    ...input,
    staffId: target,
  });
}

export async function submitWeeklyApplication(
  ports: WeeklyPayPorts,
  actor: WeeklyPayActor,
  applicationId: string,
): Promise<WeeklyApplication> {
  requireStaff(actor);
  if (!canSubmitWeeklyPay(actor)) {
    throw new WeeklyPayDomainError("FORBIDDEN", "weekly_pay.submit required");
  }
  const existing = await ports.applications.getById(actor.orgId, applicationId);
  if (!existing) {
    throw new WeeklyPayDomainError("NOT_FOUND", "weekly application");
  }
  if (existing.staffId !== actor.staffId && !canManageWeeklyPay(actor)) {
    throw new WeeklyPayDomainError("FORBIDDEN", "cannot submit another staff weekly application");
  }
  return ports.applications.submit(actor.orgId, applicationId);
}

export async function returnWeeklyApplication(
  ports: WeeklyPayPorts,
  actor: WeeklyPayActor,
  applicationId: string,
  reason: string,
): Promise<WeeklyApplication> {
  requireStaff(actor);
  if (!canReviewWeeklyPay(actor)) {
    throw new WeeklyPayDomainError("FORBIDDEN", "weekly_pay.review required");
  }
  const existing = await ports.applications.getById(actor.orgId, applicationId);
  if (!existing) {
    throw new WeeklyPayDomainError("NOT_FOUND", "weekly application");
  }
  assertNotSelfReview(existing.staffId, actor.staffId);
  return ports.applications.returnApplication(
    actor.orgId,
    applicationId,
    assertReturnReason(reason),
  );
}

export async function approveWeeklyApplication(
  ports: WeeklyPayPorts,
  actor: WeeklyPayActor,
  applicationId: string,
): Promise<WeeklyApplication> {
  requireStaff(actor);
  if (!canReviewWeeklyPay(actor)) {
    throw new WeeklyPayDomainError("FORBIDDEN", "weekly_pay.review required");
  }
  const existing = await ports.applications.getById(actor.orgId, applicationId);
  if (!existing) {
    throw new WeeklyPayDomainError("NOT_FOUND", "weekly application");
  }
  assertNotSelfReview(existing.staffId, actor.staffId);
  return ports.applications.approve(actor.orgId, applicationId);
}

export async function listWeeklyPayPolicies(
  ports: WeeklyPayPorts,
  actor: WeeklyPayActor,
): Promise<WeeklyPayPolicy[]> {
  requireStaff(actor);
  if (!canViewWeeklyPay(actor) && !canManageWeeklyPayPolicy(actor)) {
    throw new WeeklyPayDomainError("FORBIDDEN", "weekly_pay permission required");
  }
  return ports.policies.listActive(actor.orgId);
}

export async function upsertWeeklyPayPolicy(
  ports: WeeklyPayPorts,
  actor: WeeklyPayActor,
  input: Parameters<WeeklyPayPorts["policies"]["upsert"]>[1],
): Promise<WeeklyPayPolicy> {
  requireStaff(actor);
  if (!canManageWeeklyPayPolicy(actor)) {
    throw new WeeklyPayDomainError("FORBIDDEN", "weekly_pay.policy_manage required");
  }
  if (input.advanceRateBps <= 0 || input.advanceRateBps > 10000) {
    throw new WeeklyPayDomainError("INVALID_SELECTION", "advance_rate_bps out of range");
  }
  if (input.dailyCapMinutes <= 0) {
    throw new WeeklyPayDomainError("INVALID_SELECTION", "daily_cap_minutes must be > 0");
  }
  if (input.roundingUnitYen <= 0) {
    throw new WeeklyPayDomainError("INVALID_SELECTION", "rounding_unit_yen must be > 0");
  }
  return ports.policies.upsert(actor.orgId, input);
}

export async function listBankAccountsMasked(
  ports: WeeklyPayPorts,
  actor: WeeklyPayActor,
  staffId?: string,
): Promise<BankAccountMasked[]> {
  requireStaff(actor);
  if (!canViewWeeklyPay(actor)) {
    throw new WeeklyPayDomainError("FORBIDDEN", "weekly_pay view permission required");
  }
  const target =
    staffId &&
    (canReviewWeeklyPay(actor) || canManageWeeklyPay(actor) || has(actor, "weekly_pay.pay"))
      ? staffId
      : actor.staffId;
  if (staffId && staffId !== actor.staffId && target !== staffId) {
    throw new WeeklyPayDomainError("FORBIDDEN", "cannot list another staff bank accounts");
  }
  return ports.bank.listMasked(actor.orgId, target);
}

export async function upsertBankAccount(
  ports: WeeklyPayPorts,
  actor: WeeklyPayActor,
  input: UpsertBankAccountInput,
): Promise<BankAccountMasked> {
  requireStaff(actor);
  if (!canSubmitWeeklyPay(actor)) {
    throw new WeeklyPayDomainError("FORBIDDEN", "weekly_pay.submit required");
  }
  const target = input.staffId ?? actor.staffId;
  if (target !== actor.staffId && !canManageWeeklyPay(actor)) {
    throw new WeeklyPayDomainError("FORBIDDEN", "cannot manage another staff bank account");
  }
  return ports.bank.upsert(actor.orgId, { ...input, staffId: target });
}

export async function deactivateBankAccount(
  ports: WeeklyPayPorts,
  actor: WeeklyPayActor,
  bankAccountId: string,
): Promise<BankAccountMasked> {
  requireStaff(actor);
  if (!canSubmitWeeklyPay(actor)) {
    throw new WeeklyPayDomainError("FORBIDDEN", "weekly_pay.submit required");
  }
  return ports.bank.deactivate(actor.orgId, bankAccountId);
}

export async function getWorkerSettings(
  ports: WeeklyPayPorts,
  actor: WeeklyPayActor,
  staffId?: string,
): Promise<WorkerSettings | null> {
  requireStaff(actor);
  if (!canViewWeeklyPay(actor)) {
    throw new WeeklyPayDomainError("FORBIDDEN", "weekly_pay view permission required");
  }
  const target = staffId ?? actor.staffId;
  if (
    target !== actor.staffId &&
    !canReviewWeeklyPay(actor) &&
    !canManageWeeklyPay(actor) &&
    !has(actor, "weekly_pay.pay")
  ) {
    throw new WeeklyPayDomainError("FORBIDDEN", "cannot read another staff settings");
  }
  return ports.bank.getWorkerSettings(actor.orgId, target);
}

export async function upsertWorkerSettings(
  ports: WeeklyPayPorts,
  actor: WeeklyPayActor,
  input: UpsertWorkerSettingsInput,
): Promise<WorkerSettings> {
  requireStaff(actor);
  if (!canSubmitWeeklyPay(actor)) {
    throw new WeeklyPayDomainError("FORBIDDEN", "weekly_pay.submit required");
  }
  const target = input.staffId ?? actor.staffId;
  if (target !== actor.staffId && !canManageWeeklyPay(actor)) {
    throw new WeeklyPayDomainError("FORBIDDEN", "cannot manage another staff settings");
  }
  return ports.bank.upsertWorkerSettings(actor.orgId, { ...input, staffId: target });
}

export async function getApplicationBankSnapshot(
  ports: WeeklyPayPorts,
  actor: WeeklyPayActor,
  applicationId: string,
): Promise<ApplicationBankSnapshotMasked> {
  const app = await getWeeklyApplication(ports, actor, applicationId);
  const snap = await ports.applications.getBankSnapshot(actor.orgId, app.id);
  if (!snap) {
    throw new WeeklyPayDomainError("NOT_FOUND", "bank snapshot");
  }
  return snap;
}

export async function decryptApplicationBankAccountNumber(
  ports: WeeklyPayPorts,
  actor: WeeklyPayActor,
  applicationId: string,
): Promise<string> {
  requireStaff(actor);
  if (!canDecryptBankAccount(actor)) {
    throw new WeeklyPayDomainError("FORBIDDEN", "weekly_pay.pay required to decrypt");
  }
  // Generic decrypt remains unavailable; use CSV download path.
  void ports;
  void applicationId;
  throw new WeeklyPayDomainError(
    "FORBIDDEN",
    "bank account decrypt is only available via authorized CSV download",
  );
}

function requirePay(actor: WeeklyPayActor): void {
  requireStaff(actor);
  if (!canPayWeeklyPay(actor)) {
    throw new WeeklyPayDomainError("FORBIDDEN", "weekly_pay.pay required");
  }
}

export async function getTransferorSettings(
  ports: WeeklyPayPorts,
  actor: WeeklyPayActor,
): Promise<WeeklyPayTransferorSettings | null> {
  requirePay(actor);
  return ports.payments.getTransferorSettings(actor.orgId);
}

export async function upsertTransferorSettings(
  ports: WeeklyPayPorts,
  actor: WeeklyPayActor,
  input: WeeklyPayTransferorUpsertInput,
): Promise<WeeklyPayTransferorSettings> {
  requirePay(actor);
  // Validate half-width encodability before persistence.
  toHalfWidthKatakanaForSmtb(input.requesterNameKana);
  return ports.payments.upsertTransferorSettings(actor.orgId, {
    ...input,
    requesterNameKana: toHalfWidthKatakanaForSmtb(input.requesterNameKana),
    sourceBankNameKana: input.sourceBankNameKana
      ? toHalfWidthKatakanaForSmtb(input.sourceBankNameKana)
      : null,
    sourceBranchNameKana: input.sourceBranchNameKana
      ? toHalfWidthKatakanaForSmtb(input.sourceBranchNameKana)
      : null,
  });
}

export async function listPaymentBatches(
  ports: WeeklyPayPorts,
  actor: WeeklyPayActor,
): Promise<WeeklyPayPaymentBatch[]> {
  requirePay(actor);
  return ports.payments.listBatches(actor.orgId);
}

export async function getPaymentBatch(
  ports: WeeklyPayPorts,
  actor: WeeklyPayActor,
  batchId: string,
): Promise<WeeklyPayPaymentBatch> {
  requirePay(actor);
  const batch = await ports.payments.getBatch(actor.orgId, batchId);
  if (!batch) throw new WeeklyPayDomainError("NOT_FOUND", "payment batch");
  const items = await ports.payments.listBatchItems(actor.orgId, batchId);
  return { ...batch, items };
}

export async function createPaymentBatch(
  ports: WeeklyPayPorts,
  actor: WeeklyPayActor,
  input: CreateWeeklyPayPaymentBatchInput,
): Promise<WeeklyPayPaymentBatch> {
  requirePay(actor);
  if (!isJapaneseBankBusinessDay(input.bankTransferDate)) {
    throw new WeeklyPayDomainError(
      "INVALID_TRANSFER_DATE",
      "bankTransferDate is not a Japanese bank business day",
    );
  }
  const settings = await ports.payments.getTransferorSettings(actor.orgId);
  if (!settings) {
    throw new WeeklyPayDomainError(
      "TRANSFEROR_UNSET",
      "configure transferor settings before creating a payment batch",
    );
  }
  return ports.payments.createBatch(actor.orgId, input);
}

export async function cancelPaymentBatch(
  ports: WeeklyPayPorts,
  actor: WeeklyPayActor,
  batchId: string,
  reason: string,
): Promise<WeeklyPayPaymentBatch> {
  requirePay(actor);
  return ports.payments.cancelBatch(actor.orgId, batchId, reason);
}

export async function recordPaymentBatchBankSubmission(
  ports: WeeklyPayPorts,
  actor: WeeklyPayActor,
  batchId: string,
  note?: string | null,
  bankFileRef?: string | null,
): Promise<WeeklyPayPaymentBatch> {
  requirePay(actor);
  return ports.payments.recordBankSubmission(actor.orgId, batchId, note, bankFileRef);
}

export async function recordPaymentBatchItemResults(
  ports: WeeklyPayPorts,
  actor: WeeklyPayActor,
  batchId: string,
  results: WeeklyPayItemResultInput[],
): Promise<WeeklyPayPaymentBatch> {
  requirePay(actor);
  return ports.payments.recordItemResults(actor.orgId, batchId, results);
}

export async function resolveUnknownPaymentItem(
  ports: WeeklyPayPorts,
  actor: WeeklyPayActor,
  itemId: string,
  outcome: "failed" | "cancelled",
  reason?: string | null,
): Promise<WeeklyPayPaymentBatchItemMasked> {
  requirePay(actor);
  return ports.payments.resolveUnknownItem(actor.orgId, itemId, outcome, reason);
}

export async function listSettlementLedger(
  ports: WeeklyPayPorts,
  actor: WeeklyPayActor,
  staffId?: string,
): Promise<WeeklyPaySettlementLedgerEntry[]> {
  requireStaff(actor);
  if (canPayWeeklyPay(actor)) {
    return ports.payments.listSettlementLedger(actor.orgId, staffId);
  }
  if (!canViewWeeklyPay(actor)) {
    throw new WeeklyPayDomainError("FORBIDDEN", "weekly_pay view permission required");
  }
  return ports.payments.listSettlementLedger(actor.orgId, actor.staffId);
}

/**
 * Build SMTB CSV bytes. Uses service_role decrypt payload after domain authz.
 * Does not mark paid. Caller must set Cache-Control: no-store.
 */
export async function downloadPaymentBatchCsv(
  ports: WeeklyPayPorts,
  actor: WeeklyPayActor,
  batchId: string,
): Promise<{
  filename: string;
  contentType: string;
  buffer: Buffer;
  batch: WeeklyPayPaymentBatch;
}> {
  requirePay(actor);
  const payload = await ports.payments.loadCsvPayload(
    actor.orgId,
    batchId,
    actor.staffId,
  );
  const destinations = payload.destinations.map((d) => ({
    ...d,
    accountHolderKana: toHalfWidthKatakanaForSmtb(d.accountHolderKana),
    bankName: d.bankName ? toHalfWidthKatakanaForSmtb(d.bankName) : d.bankName,
    branchName: d.branchName ? toHalfWidthKatakanaForSmtb(d.branchName) : d.branchName,
  }));
  const built = buildSmtbSogoCsvBuffer({
    bankTransferDate: payload.bankTransferDate,
    transferor: {
      ...payload.transferor,
      requesterNameKana: toHalfWidthKatakanaForSmtb(payload.transferor.requesterNameKana),
      sourceBankNameKana: payload.transferor.sourceBankNameKana
        ? toHalfWidthKatakanaForSmtb(payload.transferor.sourceBankNameKana)
        : payload.transferor.sourceBankNameKana,
      sourceBranchNameKana: payload.transferor.sourceBranchNameKana
        ? toHalfWidthKatakanaForSmtb(payload.transferor.sourceBranchNameKana)
        : payload.transferor.sourceBranchNameKana,
    },
    destinations,
    expectedItemCount: payload.expectedItemCount,
    expectedTotalAmountYen: payload.expectedTotalAmountYen,
  });
  const batch = await ports.payments.recordExport(actor.orgId, batchId);
  return {
    filename: `soufuri_${batch.bankTransferDate.replaceAll("-", "")}_${batch.id.slice(0, 8)}.csv`,
    contentType: "text/csv; charset=Shift_JIS",
    buffer: built.buffer,
    batch,
  };
}
