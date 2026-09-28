/**
 * Work Record / Employment Term types.
 *
 * Shift          = planned work (never payroll SoT).
 * Work Record    = actual hours (canonical operational record).
 * Employment Term = historical hourly wage for a staff member.
 * Weekly Pay     = later phase; not a Work Record concern.
 *
 * Person identity is always `staffId`. Display names are never keys.
 */

import type { IsoDate, IsoTime, ShiftEndDayOffset } from "./types.js";

export const WORK_RECORD_STATUSES = [
  "draft",
  "confirmed",
  "locked",
  "voided",
] as const;
export type WorkRecordStatus = (typeof WORK_RECORD_STATUSES)[number];

export const WORK_RECORD_REVISION_EVENTS = [
  "created",
  "updated",
  "confirmed",
  "reopened",
  "voided",
] as const;
export type WorkRecordRevisionEvent = (typeof WORK_RECORD_REVISION_EVENTS)[number];

export const WORK_TIMEZONE = "Asia/Tokyo";

export type EmploymentTerm = {
  id: string;
  orgId: string;
  staffId: string;
  hourlyWageYen: number;
  /** Inclusive start date. */
  effectiveFrom: IsoDate;
  /** Inclusive end date, or null when open-ended. */
  effectiveTo: IsoDate | null;
  createdByStaffId: string;
  createdAt: string;
  revokedAt: string | null;
  revokedByStaffId: string | null;
  revokeReason: string | null;
  updatedAt: string | null;
};

export type WorkRecord = {
  id: string;
  orgId: string;
  staffId: string;
  workDate: IsoDate;
  startTime: IsoTime;
  endTime: IsoTime;
  endDayOffset: ShiftEndDayOffset;
  breakMinutes: number;
  /** Derived: (end - start) - break. Source of truth is DB + this helper. */
  workedMinutes: number;
  transportFeeYen: number;
  workLocationId: string | null;
  sourceShiftId: string | null;
  assignmentSource: string | null;
  assignmentExternalRef: string | null;
  status: WorkRecordStatus;
  /** Snapshot of the matching active term at confirm time. Never payroll SoT. */
  employmentTermId: string | null;
  hourlyWageSnapshotYen: number | null;
  confirmedAt: string | null;
  confirmedByStaffId: string | null;
  voidedAt: string | null;
  voidedByStaffId: string | null;
  voidReason: string | null;
  createdByStaffId: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkRecordRevision = {
  id: string;
  orgId: string;
  workRecordId: string;
  revisionNo: number;
  eventType: WorkRecordRevisionEvent;
  actorStaffId: string;
  beforeSnapshot: Record<string, unknown> | null;
  afterSnapshot: Record<string, unknown>;
  reason: string | null;
  createdAt: string;
};

export type CreateEmploymentTermInput = {
  staffId: string;
  hourlyWageYen: number;
  effectiveFrom: IsoDate;
  effectiveTo?: IsoDate | null;
  /** Close an existing open-ended active term the day before `effectiveFrom`. */
  closeOpenEnded?: boolean;
};

export type CreateWorkRecordDraftInput = {
  workRecordId?: string;
  staffId?: string;
  workDate: IsoDate;
  startTime: IsoTime;
  endTime: IsoTime;
  endDayOffset?: ShiftEndDayOffset;
  breakMinutes?: number;
  transportFeeYen?: number;
  workLocationId?: string | null;
  sourceShiftId?: string | null;
  assignmentSource?: string | null;
  assignmentExternalRef?: string | null;
};

export const WORK_AUDIT_ACTIONS = [
  "employment_term_created",
  "employment_term_revoked",
  "work_record_created",
  "work_record_updated",
  "work_record_confirmed",
  "work_record_reopened",
  "work_record_voided",
] as const;
export type WorkAuditAction = (typeof WORK_AUDIT_ACTIONS)[number];

export type WorkAuditEvent = {
  action: WorkAuditAction;
  actorStaffId: string;
  subjectStaffId: string;
  resourceType: "employment_term" | "work_record";
  resourceId: string;
  metadata: Record<string, unknown>;
};
