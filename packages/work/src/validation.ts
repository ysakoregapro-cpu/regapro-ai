import { ShiftDomainError } from "./errors.js";
import type {
  IsoDate,
  IsoTime,
  ShiftEndDayOffset,
  ShiftPreferenceType,
  ShiftRequestDateInput,
  ShiftSource,
} from "./types.js";

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const ISO_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/** Adapter keys only. Rejects display names (spaces / CJK) so names never become identity. */
export const EXTERNAL_REF_RE = /^[A-Za-z0-9][A-Za-z0-9:_./!-]{0,199}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

export function assertIsoDate(value: string, field: string): void {
  if (!isIsoDate(value)) {
    throw new ShiftDomainError("INVALID_PERIOD", `${field} must be a valid ISO date`);
  }
}

export function compareIsoDate(a: IsoDate, b: IsoDate): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function isTimeUnspecified(
  startTime: IsoTime | null | undefined,
  endTime: IsoTime | null | undefined,
): boolean {
  return (startTime ?? null) === null && (endTime ?? null) === null;
}

export function assertTimePair(
  startTime: IsoTime | null | undefined,
  endTime: IsoTime | null | undefined,
): { startTime: IsoTime | null; endTime: IsoTime | null; timeUnspecified: boolean } {
  const start = startTime ?? null;
  const end = endTime ?? null;
  if ((start === null) !== (end === null)) {
    throw new ShiftDomainError(
      "ONE_SIDED_TIME",
      "startTime and endTime must both be set or both be empty",
    );
  }
  if (start !== null && !ISO_TIME_RE.test(start)) {
    throw new ShiftDomainError("ONE_SIDED_TIME", "startTime is not a valid time");
  }
  if (end !== null && !ISO_TIME_RE.test(end)) {
    throw new ShiftDomainError("ONE_SIDED_TIME", "endTime is not a valid time");
  }
  return { startTime: start, endTime: end, timeUnspecified: start === null };
}

export function assertEndDayOffset(
  offset: number | undefined,
  timesSpecified: boolean,
): ShiftEndDayOffset {
  const value = offset ?? 0;
  if (value !== 0 && value !== 1) {
    throw new ShiftDomainError("INVALID_OFFSET", "endDayOffset must be 0 or 1");
  }
  if (value === 1 && !timesSpecified) {
    throw new ShiftDomainError(
      "INVALID_OFFSET",
      "overnight offset requires specified start and end times",
    );
  }
  return value;
}

function normalizeTime(value: IsoTime): string {
  return value.length === 5 ? `${value}:00` : value;
}

export function compareIsoTime(a: IsoTime, b: IsoTime): number {
  const left = normalizeTime(a);
  const right = normalizeTime(b);
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * Shift schedule shape:
 * - both times null and offset 0 (time unspecified)
 * - both times set and offset 0 with end > start (same calendar day)
 * - both times set and offset 1 (overnight)
 */
export function assertShiftSchedule(
  startTime: IsoTime | null | undefined,
  endTime: IsoTime | null | undefined,
  offset: number | undefined,
): {
  startTime: IsoTime | null;
  endTime: IsoTime | null;
  endDayOffset: ShiftEndDayOffset;
  timeUnspecified: boolean;
} {
  const times = assertTimePair(startTime, endTime);
  const endDayOffset = assertEndDayOffset(offset, !times.timeUnspecified);
  if (!times.timeUnspecified && endDayOffset === 0) {
    if (compareIsoTime(times.startTime as IsoTime, times.endTime as IsoTime) >= 0) {
      throw new ShiftDomainError(
        "INVALID_OFFSET",
        "same-day endTime must be after startTime",
      );
    }
  }
  return { ...times, endDayOffset };
}

export function assertRequestPeriod(periodStart: IsoDate, periodEnd: IsoDate): void {
  assertIsoDate(periodStart, "periodStart");
  assertIsoDate(periodEnd, "periodEnd");
  if (compareIsoDate(periodEnd, periodStart) < 0) {
    throw new ShiftDomainError(
      "INVALID_PERIOD",
      "periodEnd must be on or after periodStart",
    );
  }
}

export function assertWorkDateInPeriod(
  workDate: IsoDate,
  periodStart: IsoDate,
  periodEnd: IsoDate,
): void {
  assertIsoDate(workDate, "workDate");
  if (compareIsoDate(workDate, periodStart) < 0 || compareIsoDate(workDate, periodEnd) > 0) {
    throw new ShiftDomainError(
      "DATE_OUT_OF_PERIOD",
      "workDate must fall inside the request period",
    );
  }
}

export function assertPreferenceDate(
  input: ShiftRequestDateInput,
  periodStart: IsoDate,
  periodEnd: IsoDate,
): ShiftRequestDateInput & { timeUnspecified: boolean } {
  if (input.preferenceType !== "hope_work" && input.preferenceType !== "hope_off") {
    throw new ShiftDomainError("INVALID_PREFERENCE", "preferenceType must be hope_work or hope_off");
  }
  assertWorkDateInPeriod(input.workDate, periodStart, periodEnd);
  const times = assertTimePair(input.startTime, input.endTime);

  if (input.preferenceType === "hope_off") {
    if (!times.timeUnspecified || input.workLocationId) {
      throw new ShiftDomainError(
        "INVALID_PREFERENCE",
        "hope_off cannot carry a time or location",
      );
    }
  }

  return {
    ...input,
    startTime: times.startTime,
    endTime: times.endTime,
    timeUnspecified: times.timeUnspecified,
  };
}

export function assertUniqueDates(dates: readonly { workDate: IsoDate }[]): void {
  const seen = new Set<string>();
  for (const row of dates) {
    if (seen.has(row.workDate)) {
      throw new ShiftDomainError(
        "DUPLICATE_DATE",
        "only one preference is allowed per date in a request",
      );
    }
    seen.add(row.workDate);
  }
}

export function assertExternalRef(
  source: ShiftSource,
  externalRef: string | null | undefined,
): string | null {
  const ref = externalRef ?? null;
  if (ref === null || ref === "") return null;
  if (!EXTERNAL_REF_RE.test(ref)) {
    throw new ShiftDomainError(
      "INVALID_EXTERNAL_REF",
      "externalRef must be an adapter key, never a person name",
    );
  }
  void source;
  return ref;
}

export function assertPreReportUrl(url: string | null | undefined): string | null {
  const value = url ?? null;
  if (value === null || value === "") return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ShiftDomainError("INVALID_PRE_REPORT_URL", "preReportUrl must be an http(s) URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ShiftDomainError("INVALID_PRE_REPORT_URL", "preReportUrl must be an http(s) URL");
  }
  return value;
}

export function nextRequestVersion(existingVersions: readonly number[]): number {
  if (existingVersions.length === 0) return 1;
  return Math.max(...existingVersions) + 1;
}

export function preferenceTypeOf(
  value: string,
): ShiftPreferenceType {
  if (value === "hope_work" || value === "hope_off") return value;
  throw new ShiftDomainError("INVALID_PREFERENCE", "unknown preference type");
}
