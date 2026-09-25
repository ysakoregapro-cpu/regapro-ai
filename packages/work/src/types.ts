/**
 * Shift Domain types.
 *
 * Shift = planned work (勤務予定).
 * Work Record = actual hours (Phase 3 — not in this package yet).
 * Weekly Pay = pay from confirmed Work Records (Phase 4+ — not here).
 *
 * Person identity is always `staffId`. Display names are never keys.
 */

export const SHIFT_REQUEST_STATUSES = [
  "draft",
  "submitted",
  "superseded",
  "cancelled",
] as const;
export type ShiftRequestStatus = (typeof SHIFT_REQUEST_STATUSES)[number];

export const SHIFT_PREFERENCE_TYPES = ["hope_work", "hope_off"] as const;
export type ShiftPreferenceType = (typeof SHIFT_PREFERENCE_TYPES)[number];

export const SHIFT_STATUSES = ["draft", "published", "cancelled"] as const;
export type ShiftStatus = (typeof SHIFT_STATUSES)[number];

export const SHIFT_SOURCES = ["internal", "spreadsheet", "imported"] as const;
export type ShiftSource = (typeof SHIFT_SOURCES)[number];

export const SHIFT_END_DAY_OFFSETS = [0, 1] as const;
export type ShiftEndDayOffset = (typeof SHIFT_END_DAY_OFFSETS)[number];

export type IsoDate = string;
export type IsoTime = string;

export type WorkLocation = {
  id: string;
  orgId: string;
  code: string;
  name: string;
  addressText: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type ShiftRequestDate = {
  id: string;
  shiftRequestId: string;
  orgId: string;
  workDate: IsoDate;
  preferenceType: ShiftPreferenceType;
  startTime: IsoTime | null;
  endTime: IsoTime | null;
  workLocationId: string | null;
  note: string | null;
  /** Derived: both times null. Never stored as an independent write field. */
  timeUnspecified: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ShiftRequest = {
  id: string;
  orgId: string;
  staffId: string;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  version: number;
  previousRequestId: string | null;
  status: ShiftRequestStatus;
  requestedByStaffId: string;
  submittedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  dates: ShiftRequestDate[];
};

export type Shift = {
  id: string;
  orgId: string;
  staffId: string;
  workDate: IsoDate;
  startTime: IsoTime | null;
  endTime: IsoTime | null;
  endDayOffset: ShiftEndDayOffset;
  workLocationId: string | null;
  source: ShiftSource;
  sourceRequestDateId: string | null;
  externalRef: string | null;
  status: ShiftStatus;
  note: string | null;
  preReportUrl: string | null;
  /** Derived: both times null. Never an independent write field. */
  timeUnspecified: boolean;
  publishedAt: string | null;
  publishedByStaffId: string | null;
  cancelledAt: string | null;
  cancelledByStaffId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ShiftRequestDateInput = {
  workDate: IsoDate;
  preferenceType: ShiftPreferenceType;
  startTime?: IsoTime | null;
  endTime?: IsoTime | null;
  workLocationId?: string | null;
  note?: string | null;
};

export type CreateShiftRequestDraftInput = {
  periodStart: IsoDate;
  periodEnd: IsoDate;
  dates: ShiftRequestDateInput[];
  /** Manager-only: create a draft for another staff member. */
  forStaffId?: string;
};

export type CreateShiftInput = {
  staffId: string;
  workDate: IsoDate;
  startTime?: IsoTime | null;
  endTime?: IsoTime | null;
  endDayOffset?: ShiftEndDayOffset;
  workLocationId?: string | null;
  source?: ShiftSource;
  sourceRequestDateId?: string | null;
  externalRef?: string | null;
  note?: string | null;
  preReportUrl?: string | null;
};

export const SHIFT_AUDIT_ACTIONS = [
  "shift_request_submitted",
  "shift_request_superseded",
  "shift_request_cancelled",
  "shift_published",
  "shift_cancelled",
] as const;
export type ShiftAuditAction = (typeof SHIFT_AUDIT_ACTIONS)[number];

export type ShiftAuditEvent = {
  action: ShiftAuditAction;
  actorStaffId: string;
  subjectStaffId: string;
  resourceType: "shift_request" | "shift";
  resourceId: string;
  metadata: Record<string, unknown>;
};
