import type { PlatformPermission } from "@regapro/shared";
import { WeeklyPayDomainError } from "./weekly-pay-errors.js";
import { assertNotSelfReview, assertReturnReason } from "./weekly-pay-lifecycle.js";
import type { WeeklyPayPorts } from "./weekly-pay-ports.js";
import type {
  ApplicationBankSnapshotMasked,
  BankAccountMasked,
  CreateWeeklyApplicationDraftInput,
  UpsertBankAccountInput,
  UpsertWorkerSettingsInput,
  WeeklyApplication,
  WeeklyApplicationListQuery,
  WeeklyPayPolicy,
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
  // Ensure the application is visible in-org before decrypt.
  await getWeeklyApplication(ports, actor, applicationId);
  return ports.bank.decryptApplicationAccountNumber(actor.orgId, applicationId);
}
