import { WorkDomainError } from "./work-errors.js";
import type { EmploymentTerm } from "./work-types.js";
import type { IsoDate, IsoTime, Shift, ShiftEndDayOffset } from "./types.js";
import {
  EXTERNAL_REF_RE,
  ISO_TIME_RE,
  assertIsoDate as assertIsoDateShared,
  compareIsoDate,
} from "./validation.js";

function assertIsoDate(value: string, field: string): void {
  try {
    assertIsoDateShared(value, field);
  } catch {
    throw new WorkDomainError("INVALID_SCHEDULE", `${field} must be a valid ISO date`);
  }
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function parseTimeParts(time: IsoTime): { h: number; m: number; s: number } {
  if (!ISO_TIME_RE.test(time)) {
    throw new WorkDomainError("INVALID_SCHEDULE", "startTime/endTime must be a valid time");
  }
  const [h, m, s] = time.split(":").map(Number);
  return { h: h ?? 0, m: m ?? 0, s: s ?? 0 };
}

/**
 * Civil-minute arithmetic. Japan has no DST, so UTC calendar math matches
 * Asia/Tokyo wall-clock duration.
 */
export function civilInstantMs(
  workDate: IsoDate,
  time: IsoTime,
  dayOffset: number,
): number {
  assertIsoDate(workDate, "workDate");
  const [year, month, day] = workDate.split("-").map(Number);
  const { h, m, s } = parseTimeParts(time);
  return Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + dayOffset, h, m, s);
}

export function addDaysIso(date: IsoDate, days: number): IsoDate {
  assertIsoDate(date, "date");
  const [year, month, day] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** Inclusive dates: 9/1–9/30 includes 9/30. NULL to = open-ended. */
export function inclusiveDateRangesOverlap(
  aFrom: IsoDate,
  aTo: IsoDate | null,
  bFrom: IsoDate,
  bTo: IsoDate | null,
): boolean {
  const aEnd = aTo ?? "9999-12-31";
  const bEnd = bTo ?? "9999-12-31";
  return compareIsoDate(aFrom, bEnd) <= 0 && compareIsoDate(bFrom, aEnd) <= 0;
}

export function areInclusiveRangesAdjacent(aTo: IsoDate, bFrom: IsoDate): boolean {
  return addDaysIso(aTo, 1) === bFrom;
}

export function assertHourlyWage(yen: number): number {
  if (!Number.isInteger(yen) || yen <= 0) {
    throw new WorkDomainError("INVALID_WAGE", "hourlyWageYen must be an integer greater than 0");
  }
  return yen;
}

export function assertInclusiveTermRange(
  effectiveFrom: IsoDate,
  effectiveTo: IsoDate | null,
): void {
  assertIsoDate(effectiveFrom, "effectiveFrom");
  if (effectiveTo !== null) {
    assertIsoDate(effectiveTo, "effectiveTo");
    if (compareIsoDate(effectiveTo, effectiveFrom) < 0) {
      throw new WorkDomainError(
        "INVALID_TERM_RANGE",
        "effectiveTo must be on or after effectiveFrom",
      );
    }
  }
}

export function assertActiveTermsDoNotOverlap(
  incoming: { effectiveFrom: IsoDate; effectiveTo: IsoDate | null },
  existing: readonly Pick<
    EmploymentTerm,
    "effectiveFrom" | "effectiveTo" | "revokedAt"
  >[],
): void {
  for (const term of existing) {
    if (term.revokedAt !== null) continue;
    if (
      inclusiveDateRangesOverlap(
        incoming.effectiveFrom,
        incoming.effectiveTo,
        term.effectiveFrom,
        term.effectiveTo,
      )
    ) {
      throw new WorkDomainError(
        "TERM_OVERLAP",
        "active employment terms cannot overlap for the same staff",
      );
    }
  }
}

export function assertWorkRecordSchedule(
  startTime: IsoTime,
  endTime: IsoTime,
  offset: number | undefined,
): { startTime: IsoTime; endTime: IsoTime; endDayOffset: ShiftEndDayOffset } {
  if (!ISO_TIME_RE.test(startTime) || !ISO_TIME_RE.test(endTime)) {
    throw new WorkDomainError("INVALID_SCHEDULE", "startTime and endTime must both be set");
  }
  const endDayOffset = (offset ?? 0) as number;
  if (endDayOffset !== 0 && endDayOffset !== 1) {
    throw new WorkDomainError("INVALID_SCHEDULE", "endDayOffset must be 0 or 1");
  }
  if (endDayOffset === 0) {
    const start = civilInstantMs("2000-01-01", startTime, 0);
    const end = civilInstantMs("2000-01-01", endTime, 0);
    if (end <= start) {
      throw new WorkDomainError(
        "INVALID_SCHEDULE",
        "same-day endTime must be after startTime",
      );
    }
  }
  return { startTime, endTime, endDayOffset: endDayOffset as ShiftEndDayOffset };
}

export function computeWorkedMinutes(input: {
  workDate: IsoDate;
  startTime: IsoTime;
  endTime: IsoTime;
  endDayOffset: ShiftEndDayOffset;
  breakMinutes: number;
}): number {
  assertIsoDate(input.workDate, "workDate");
  const schedule = assertWorkRecordSchedule(
    input.startTime,
    input.endTime,
    input.endDayOffset,
  );
  if (!Number.isInteger(input.breakMinutes) || input.breakMinutes < 0) {
    throw new WorkDomainError("INVALID_BREAK", "breakMinutes must be >= 0");
  }
  const start = civilInstantMs(input.workDate, schedule.startTime, 0);
  const end = civilInstantMs(input.workDate, schedule.endTime, schedule.endDayOffset);
  const span = Math.round((end - start) / 60_000);
  if (input.breakMinutes >= span) {
    throw new WorkDomainError(
      "INVALID_BREAK",
      "breakMinutes must be less than the scheduled duration",
    );
  }
  const worked = span - input.breakMinutes;
  if (worked <= 0) {
    throw new WorkDomainError("INVALID_SCHEDULE", "workedMinutes must be greater than 0");
  }
  return worked;
}

export function assertTransportFee(yen: number): number {
  if (!Number.isInteger(yen) || yen < 0) {
    throw new WorkDomainError("INVALID_TRANSPORT", "transportFeeYen must be >= 0");
  }
  return yen;
}

export function workEndInstantMs(
  workDate: IsoDate,
  endTime: IsoTime,
  endDayOffset: ShiftEndDayOffset,
): number {
  assertIsoDate(workDate, "workDate");
  const [year, month, day] = workDate.split("-").map(Number);
  const dt = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + endDayOffset));
  const ymd = `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
  const time = endTime.length === 5 ? `${endTime}:00` : endTime;
  return Date.parse(`${ymd}T${time}+09:00`);
}

export function assertConfirmEndNotFuture(
  input: {
    workDate: IsoDate;
    endTime: IsoTime;
    endDayOffset: ShiftEndDayOffset;
  },
  now: Date = new Date(),
): void {
  const endMs = workEndInstantMs(input.workDate, input.endTime, input.endDayOffset);
  if (Number.isNaN(endMs) || endMs > now.getTime()) {
    throw new WorkDomainError(
      "FUTURE_CONFIRM",
      "a future work record cannot be confirmed",
    );
  }
}

/** Half-open [start, end) so adjacent blocks (10–14 and 14–18) do not overlap. */
export function workRecordTimeRangesOverlap(
  a: {
    workDate: IsoDate;
    startTime: IsoTime;
    endTime: IsoTime;
    endDayOffset: ShiftEndDayOffset;
  },
  b: {
    workDate: IsoDate;
    startTime: IsoTime;
    endTime: IsoTime;
    endDayOffset: ShiftEndDayOffset;
  },
): boolean {
  const a0 = civilInstantMs(a.workDate, a.startTime, 0);
  const a1 = civilInstantMs(a.workDate, a.endTime, a.endDayOffset);
  const b0 = civilInstantMs(b.workDate, b.startTime, 0);
  const b1 = civilInstantMs(b.workDate, b.endTime, b.endDayOffset);
  return a0 < b1 && b0 < a1;
}

export function assertAssignmentRef(
  source: string | null | undefined,
  externalRef: string | null | undefined,
): { assignmentSource: string | null; assignmentExternalRef: string | null } {
  const assignmentSource = source?.trim() ? source.trim() : null;
  const assignmentExternalRef = externalRef?.trim() ? externalRef.trim() : null;
  if (assignmentSource && !EXTERNAL_REF_RE.test(assignmentSource)) {
    throw new WorkDomainError(
      "INVALID_EXTERNAL_REF",
      "assignmentSource must be an adapter key, never a person name",
    );
  }
  if (assignmentExternalRef && !EXTERNAL_REF_RE.test(assignmentExternalRef)) {
    throw new WorkDomainError(
      "INVALID_EXTERNAL_REF",
      "assignmentExternalRef must be an adapter key, never a person name",
    );
  }
  return { assignmentSource, assignmentExternalRef };
}

/**
 * Shift may prefill a draft. Times remain independently editable afterwards.
 * Shift is never the Work Record source of truth.
 */
export function prefillDraftFromShift(shift: Shift): {
  staffId: string;
  workDate: IsoDate;
  startTime: IsoTime;
  endTime: IsoTime;
  endDayOffset: ShiftEndDayOffset;
  workLocationId: string | null;
  sourceShiftId: string;
} {
  if (!shift.startTime || !shift.endTime) {
    throw new WorkDomainError(
      "INVALID_SCHEDULE",
      "a time-unspecified shift cannot prefill a work record",
    );
  }
  return {
    staffId: shift.staffId,
    workDate: shift.workDate,
    startTime: shift.startTime,
    endTime: shift.endTime,
    endDayOffset: shift.endDayOffset,
    workLocationId: shift.workLocationId,
    sourceShiftId: shift.id,
  };
}

export function findActiveTermForDate(
  terms: readonly EmploymentTerm[],
  workDate: IsoDate,
): EmploymentTerm | null {
  const matches = terms.filter(
    (term) =>
      term.revokedAt === null &&
      compareIsoDate(term.effectiveFrom, workDate) <= 0 &&
      (term.effectiveTo === null || compareIsoDate(term.effectiveTo, workDate) >= 0),
  );
  if (matches.length === 0) return null;
  return matches.sort((a, b) => compareIsoDate(b.effectiveFrom, a.effectiveFrom))[0] ?? null;
}

export function wageSnapshotOnConfirm(term: EmploymentTerm | null): {
  employmentTermId: string | null;
  hourlyWageSnapshotYen: number | null;
} {
  if (!term) {
    return { employmentTermId: null, hourlyWageSnapshotYen: null };
  }
  return { employmentTermId: term.id, hourlyWageSnapshotYen: term.hourlyWageYen };
}

export function isWorkDateCoveredByTerm(
  workDate: IsoDate,
  term: Pick<EmploymentTerm, "effectiveFrom" | "effectiveTo">,
): boolean {
  return (
    compareIsoDate(term.effectiveFrom, workDate) <= 0 &&
    (term.effectiveTo === null || compareIsoDate(term.effectiveTo, workDate) >= 0)
  );
}

/**
 * Mirrors the work_records wage-snapshot trigger.
 * Revoked terms are historical only when confirmed_at < revoked_at.
 */
export function assertWageSnapshotIntegrity(input: {
  orgId: string;
  staffId: string;
  workDate: IsoDate;
  employmentTermId: string | null;
  hourlyWageSnapshotYen: number | null;
  confirmedAt: string | null;
  term: EmploymentTerm | null;
}): void {
  if (input.employmentTermId === null && input.hourlyWageSnapshotYen === null) {
    return;
  }
  if (!input.term || input.term.id !== input.employmentTermId) {
    throw new WorkDomainError("NOT_FOUND", "employment term");
  }
  if (input.term.orgId !== input.orgId || input.term.staffId !== input.staffId) {
    throw new WorkDomainError("FORBIDDEN", "employment term must match org and staff");
  }
  if (!isWorkDateCoveredByTerm(input.workDate, input.term)) {
    throw new WorkDomainError("INVALID_TERM_RANGE", "work_date is outside the employment term");
  }
  if (input.hourlyWageSnapshotYen !== input.term.hourlyWageYen) {
    throw new WorkDomainError("INVALID_WAGE", "hourly_wage_snapshot_yen must match the term");
  }
  if (
    input.term.revokedAt !== null &&
    (input.confirmedAt === null || input.confirmedAt >= input.term.revokedAt)
  ) {
    throw new WorkDomainError("CONFLICT", "cannot snapshot a revoked employment term");
  }
}

/** Canonical org+staff lock shared by create/revoke term and confirm snapshot. */
export const EMPLOYMENT_TERM_LOCK_SEED = 331877;
export const EMPLOYMENT_TERM_LOCK_RPCS = [
  "create_employment_term",
  "revoke_employment_term",
  "confirm_work_record",
] as const;

/**
 * Shared lock order for Employment Term lifecycle RPCs.
 * Advisory scope is acquired before any FOR UPDATE on the target row.
 */
export const EMPLOYMENT_TERM_LOCK_ORDER = [
  "read_org_staff_unlocked",
  "advisory_term_scope",
  "select_for_update",
  "revalidate_after_lock",
  "mutate_or_snapshot",
] as const;

export const CONFIRM_WORK_RECORD_LOCK_ORDER = [
  "select_work_record_unlocked",
  "advisory_term_scope",
  "select_work_record_for_update",
  "revalidate_status_org_staff_permission",
  "select_active_employment_term",
  "snapshot",
] as const;

export function employmentTermLockScope(orgId: string, staffId: string): string {
  return `${orgId}:term:${staffId}`;
}

export function nextRevisionNo(existing: readonly number[]): number {
  if (existing.length === 0) return 1;
  return Math.max(...existing) + 1;
}
