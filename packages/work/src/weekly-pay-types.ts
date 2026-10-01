/**
 * Weekly Pay Application / Policy Snapshot types (Phase 4).
 *
 * Inputs: confirmed Work Records + employment wage snapshots + policy.
 * Shift is never payroll SoT. Paid / transfer CSV are later phases.
 * Phase 5: bank accounts + application bank snapshots (masked in APIs).
 * Phase 6: payment batches, SMTB CSV, settlement ledger (paid ≠ approved).
 */

import type { IsoDate, IsoTime } from "./types.js";

export const WEEKLY_APPLICATION_STATUSES = [
  "draft",
  "submitted",
  "returned",
  "approved",
] as const;
export type WeeklyApplicationStatus = (typeof WEEKLY_APPLICATION_STATUSES)[number];

/** How the daily eligible-minutes cap is applied across multiple work records. */
export const WEEKLY_PAY_DAILY_CAP_SCOPES = [
  "per_work_record",
  "per_calendar_day",
] as const;
export type WeeklyPayDailyCapScope = (typeof WEEKLY_PAY_DAILY_CAP_SCOPES)[number];

export const WEEKLY_PAY_TIMEZONE = "Asia/Tokyo";

export type WeeklyPayPolicy = {
  id: string;
  orgId: string;
  version: number;
  /** Basis points. 7000 = 70%. */
  advanceRateBps: number;
  dailyCapMinutes: number;
  dailyCapScope: WeeklyPayDailyCapScope;
  roundingUnitYen: number;
  includeTransportFee: boolean;
  /** ISO dow of week start: 1 = Monday. */
  weekStartIsoDow: number;
  /** Days from week_start to payment_date. Old system: 11 (Friday after Sunday). */
  paymentOffsetDays: number;
  effectiveFrom: IsoDate;
  effectiveTo: IsoDate | null;
  createdByStaffId: string;
  createdAt: string;
  revokedAt: string | null;
};

export type WeeklyPayPolicySnapshot = {
  policyId: string;
  version: number;
  advanceRateBps: number;
  dailyCapMinutes: number;
  dailyCapScope: WeeklyPayDailyCapScope;
  roundingUnitYen: number;
  includeTransportFee: boolean;
  weekStartIsoDow: number;
  paymentOffsetDays: number;
};

export type WeeklyApplicationItem = {
  id: string;
  applicationId: string;
  orgId: string;
  workRecordId: string;
  workRecordRevisionNo: number;
  workDate: IsoDate;
  startTime: IsoTime;
  endTime: IsoTime;
  endDayOffset: 0 | 1;
  workedMinutes: number;
  eligibleMinutes: number;
  employmentTermId: string;
  hourlyWageYen: number;
  transportFeeYen: number;
  eligibleAmountYen: number;
  policyId: string;
  policyVersion: number;
  calculationTrace: WeeklyPayItemCalculationTrace;
  createdAt: string;
};

export type WeeklyPayItemCalculationTrace = {
  workedMinutes: number;
  dailyCapMinutes: number;
  dailyCapScope: WeeklyPayDailyCapScope;
  eligibleMinutes: number;
  hourlyWageYen: number;
  advanceRateBps: number;
  includeTransportFee: boolean;
  transportFeeYen: number;
  rawAmountYen: number;
  roundingUnitYen: number;
  eligibleAmountYen: number;
  formula: string;
};

export type WeeklyApplication = {
  id: string;
  orgId: string;
  staffId: string;
  weekStart: IsoDate;
  weekEnd: IsoDate;
  cutoffAt: string;
  paymentDate: IsoDate;
  status: WeeklyApplicationStatus;
  totalAmountYen: number;
  policyId: string;
  policyVersion: number;
  policySnapshot: WeeklyPayPolicySnapshot;
  submittedAt: string | null;
  submittedByStaffId: string | null;
  returnedAt: string | null;
  returnedByStaffId: string | null;
  returnReason: string | null;
  approvedAt: string | null;
  approvedByStaffId: string | null;
  createdByStaffId: string;
  createdAt: string;
  updatedAt: string;
  items?: WeeklyApplicationItem[];
};

export type WeeklyPayWorkRecordInput = {
  id: string;
  workDate: IsoDate;
  startTime: IsoTime;
  endTime: IsoTime;
  endDayOffset: 0 | 1;
  workedMinutes: number;
  transportFeeYen: number;
  status: "draft" | "confirmed" | "locked" | "voided";
  employmentTermId: string | null;
  hourlyWageSnapshotYen: number | null;
  revisionNo: number;
};

export type CreateWeeklyApplicationDraftInput = {
  workRecordIds: string[];
  /** Defaults to actor staff. Managers may specify another staff with manage. */
  staffId?: string;
};

export type WeeklyApplicationListQuery = {
  fromWeekStart?: IsoDate;
  toWeekStart?: IsoDate;
  staffId?: string;
  status?: WeeklyApplicationStatus;
};

export const BANK_ACCOUNT_TYPES = ["ordinary", "current"] as const;
export type BankAccountType = (typeof BANK_ACCOUNT_TYPES)[number];

export const BANK_ACCOUNT_STATUSES = ["active", "inactive"] as const;
export type BankAccountStatus = (typeof BANK_ACCOUNT_STATUSES)[number];

/** Masked bank account view — never includes plaintext account number. */
export type BankAccountMasked = {
  id: string;
  orgId: string;
  staffId: string;
  bankName: string;
  bankCode: string;
  branchName: string;
  branchCode: string;
  accountType: BankAccountType;
  accountNumberLast4: string;
  accountHolderKana: string;
  status: BankAccountStatus;
  createdByStaffId: string;
  createdAt: string;
  updatedAt: string;
  deactivatedAt: string | null;
};

export type ApplicationBankSnapshotMasked = {
  applicationId: string;
  orgId: string;
  staffId: string;
  sourceBankAccountId: string | null;
  bankName: string;
  bankCode: string;
  branchName: string;
  branchCode: string;
  accountType: BankAccountType;
  accountNumberLast4: string;
  accountHolderKana: string;
  createdAt: string;
};

export type WorkerSettings = {
  staffId: string;
  orgId: string;
  weeklyPayEnabled: boolean;
  activeBankAccountId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UpsertBankAccountInput = {
  bankName: string;
  bankCode: string;
  branchName: string;
  branchCode: string;
  accountType: BankAccountType;
  accountNumber: string;
  accountHolderKana: string;
  staffId?: string;
};

export type UpsertWorkerSettingsInput = {
  weeklyPayEnabled: boolean;
  activeBankAccountId?: string | null;
  staffId?: string;
};

export const WEEKLY_PAY_BATCH_STATUSES = [
  "confirmed",
  "exported",
  "bank_submitted",
  "settling",
  "closed",
  "cancelled",
  "superseded",
] as const;
export type WeeklyPayBatchStatus = (typeof WEEKLY_PAY_BATCH_STATUSES)[number];

export const WEEKLY_PAY_ITEM_OUTCOMES = [
  "pending",
  "paid",
  "failed",
  "unknown",
  "cancelled",
] as const;
export type WeeklyPayItemOutcome = (typeof WEEKLY_PAY_ITEM_OUTCOMES)[number];

export type WeeklyPayTransferorSettings = {
  orgId: string;
  consignorCode: string;
  requesterNameKana: string;
  sourceBankCode: string;
  sourceBankNameKana: string | null;
  sourceBranchCode: string;
  sourceBranchNameKana: string | null;
  sourceAccountType: BankAccountType;
  /** Never expose full number in general UI — last4 for display helpers. */
  sourceAccountNumberLast4: string;
  updatedAt: string;
};

export type WeeklyPayTransferorUpsertInput = {
  consignorCode: string;
  requesterNameKana: string;
  sourceBankCode: string;
  sourceBankNameKana?: string | null;
  sourceBranchCode: string;
  sourceBranchNameKana?: string | null;
  sourceAccountType: BankAccountType;
  sourceAccountNumber: string;
};

export type WeeklyPayPaymentBatchItemMasked = {
  id: string;
  batchId: string;
  orgId: string;
  applicationId: string;
  staffId: string;
  amountYen: number;
  weekStart: IsoDate;
  weekEnd: IsoDate;
  applicationPaymentDate: IsoDate;
  workRecordIds: string[];
  bankCode: string;
  branchCode: string;
  accountType: BankAccountType;
  accountNumberLast4: string;
  accountHolderKana: string;
  outcome: WeeklyPayItemOutcome;
  paidOn: IsoDate | null;
  bankTransactionRef: string | null;
  failureReason: string | null;
};

export type WeeklyPayPaymentBatch = {
  id: string;
  orgId: string;
  status: WeeklyPayBatchStatus;
  bankTransferDate: IsoDate;
  scheduledPaymentDate: IsoDate | null;
  formatCode: string;
  itemCount: number;
  totalAmountYen: number;
  contentFingerprint: string;
  exportCount: number;
  exportedAt: string | null;
  bankSubmittedAt: string | null;
  bankSubmissionNote: string | null;
  bankFileRef: string | null;
  createdByStaffId: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  closedAt: string | null;
  items?: WeeklyPayPaymentBatchItemMasked[];
};

export type CreateWeeklyPayPaymentBatchInput = {
  applicationIds: string[];
  bankTransferDate: IsoDate;
  scheduledPaymentDate?: IsoDate | null;
};

export type WeeklyPayItemResultInput = {
  itemId: string;
  outcome: "paid" | "failed" | "unknown";
  paidOn?: IsoDate;
  bankTransactionRef?: string;
  evidenceNote?: string;
  failureReason?: string;
};

export type WeeklyPaySettlementLedgerEntry = {
  id: string;
  orgId: string;
  staffId: string;
  applicationId: string;
  batchItemId: string;
  workRecordIds: string[];
  weekStart: IsoDate;
  weekEnd: IsoDate;
  amountYen: number;
  paidOn: IsoDate;
  confirmedByStaffId: string;
  bankTransactionRef: string | null;
  evidenceNote: string | null;
  createdAt: string;
};
