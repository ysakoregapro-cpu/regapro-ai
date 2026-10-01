/**
 * Weekly Pay Application / Policy Snapshot types (Phase 4).
 *
 * Inputs: confirmed Work Records + employment wage snapshots + policy.
 * Shift is never payroll SoT. Bank / paid status are later phases.
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
