/**
 * Weekly Pay calculation — mirrors old regapro-weekly-pay SQL and extends it
 * for multiple work records per calendar day.
 *
 * Old formula (per record, 1 record/day):
 *   ((wage * least(minutes, 480) * 70) / 6000 / 500) * 500
 *
 * Phase 4 default policy uses the same integer arithmetic with parameterized
 * rate/cap/rounding, and applies the daily cap across a calendar day in
 * chronological order (consensus wording: 1日8時間相当まで).
 */

import { WeeklyPayDomainError } from "./weekly-pay-errors.js";
import type {
  WeeklyPayDailyCapScope,
  WeeklyPayItemCalculationTrace,
  WeeklyPayPolicySnapshot,
  WeeklyPayWorkRecordInput,
} from "./weekly-pay-types.js";
import type { IsoDate } from "./types.js";

export type WeeklyPayCalcItemResult = {
  workRecordId: string;
  workDate: IsoDate;
  workedMinutes: number;
  eligibleMinutes: number;
  hourlyWageYen: number;
  employmentTermId: string;
  transportFeeYen: number;
  workRecordRevisionNo: number;
  eligibleAmountYen: number;
  calculationTrace: WeeklyPayItemCalculationTrace;
};

export type WeeklyPayCalcResult = {
  weekStart: IsoDate;
  weekEnd: IsoDate;
  cutoffAt: string;
  paymentDate: IsoDate;
  totalAmountYen: number;
  items: WeeklyPayCalcItemResult[];
};

function parseIsoDateParts(date: IsoDate): { y: number; m: number; d: number } {
  const [ys, ms, ds] = date.split("-");
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) {
    throw new WeeklyPayDomainError("INVALID_SELECTION", `invalid date ${date}`);
  }
  return { y, m, d };
}

/** Monday of the ISO week containing `date` (Asia/Tokyo calendar date). */
export function weekStartFor(date: IsoDate, weekStartIsoDow = 1): IsoDate {
  if (weekStartIsoDow !== 1) {
    throw new WeeklyPayDomainError(
      "INVALID_SELECTION",
      "only ISO Monday week_start (1) is supported in Phase 4",
    );
  }
  const { y, m, d } = parseIsoDateParts(date);
  const utc = new Date(Date.UTC(y, m - 1, d));
  // JS: Sunday=0 ... Saturday=6. ISO: Monday=1 ... Sunday=7.
  const jsDow = utc.getUTCDay();
  const isoDow = jsDow === 0 ? 7 : jsDow;
  utc.setUTCDate(utc.getUTCDate() - (isoDow - 1));
  return utc.toISOString().slice(0, 10);
}

export function weekEndFor(weekStart: IsoDate): IsoDate {
  const { y, m, d } = parseIsoDateParts(weekStart);
  const utc = new Date(Date.UTC(y, m - 1, d + 6));
  return utc.toISOString().slice(0, 10);
}

/** Exclusive cutoff: next Monday 00:00 Asia/Tokyo (= Sunday 23:59 end). */
export function cutoffAtForWeek(weekStart: IsoDate): string {
  const { y, m, d } = parseIsoDateParts(weekStart);
  const pad = (n: number) => String(n).padStart(2, "0");
  const next = new Date(Date.UTC(y, m - 1, d + 7));
  const ys = next.getUTCFullYear();
  const ms = pad(next.getUTCMonth() + 1);
  const ds = pad(next.getUTCDate());
  // Fixed offset for Asia/Tokyo (no DST).
  return `${ys}-${ms}-${ds}T00:00:00+09:00`;
}

export function paymentDateForWeek(weekStart: IsoDate, paymentOffsetDays: number): IsoDate {
  const { y, m, d } = parseIsoDateParts(weekStart);
  const utc = new Date(Date.UTC(y, m - 1, d + paymentOffsetDays));
  return utc.toISOString().slice(0, 10);
}

/**
 * Integer weekly-pay amount for one item after eligible minutes are known.
 * Matches old: ((wage * minutes * 70) / 6000 / 500) * 500 when rate=7000, unit=500.
 */
export function calculateItemAmountYen(input: {
  hourlyWageYen: number;
  eligibleMinutes: number;
  advanceRateBps: number;
  roundingUnitYen: number;
  includeTransportFee: boolean;
  transportFeeYen: number;
}): { rawAmountYen: number; eligibleAmountYen: number } {
  const {
    hourlyWageYen,
    eligibleMinutes,
    advanceRateBps,
    roundingUnitYen,
    includeTransportFee,
    transportFeeYen,
  } = input;
  if (hourlyWageYen < 0 || eligibleMinutes < 0 || advanceRateBps < 0 || roundingUnitYen <= 0) {
    throw new WeeklyPayDomainError("INVALID_SELECTION", "invalid calculation inputs");
  }
  // wage * minutes * rate_bps / (60 * 10000)
  const raw =
    (BigInt(hourlyWageYen) * BigInt(eligibleMinutes) * BigInt(advanceRateBps)) /
    600000n;
  let rawAmountYen = Number(raw);
  if (includeTransportFee) {
    rawAmountYen += transportFeeYen;
  }
  const unit = BigInt(roundingUnitYen);
  const eligibleAmountYen = Number((BigInt(rawAmountYen) / unit) * unit);
  return { rawAmountYen, eligibleAmountYen };
}

function recordSortKey(r: WeeklyPayWorkRecordInput): string {
  const offset = r.endDayOffset; // start uses work_date
  return `${r.workDate}T${r.startTime}|${offset}|${r.id}`;
}

/**
 * Allocate daily eligible minutes then compute per-item rounded amounts.
 * Rounding is per item (old behavior), then summed — not re-rounded at week total.
 */
export function calculateWeeklyPayForRecords(
  records: WeeklyPayWorkRecordInput[],
  policy: WeeklyPayPolicySnapshot,
  options?: { today?: IsoDate; nowIso?: string },
): WeeklyPayCalcResult {
  if (records.length === 0) {
    throw new WeeklyPayDomainError("INVALID_SELECTION", "no work records selected");
  }

  const today = options?.today;
  const sorted = [...records].sort((a, b) =>
    recordSortKey(a).localeCompare(recordSortKey(b)),
  );

  const first = sorted[0];
  if (!first) {
    throw new WeeklyPayDomainError("INVALID_SELECTION", "no work records selected");
  }
  const weekStart = weekStartFor(first.workDate, policy.weekStartIsoDow);
  const weekEnd = weekEndFor(weekStart);
  const cutoffAt = cutoffAtForWeek(weekStart);
  const paymentDate = paymentDateForWeek(weekStart, policy.paymentOffsetDays);

  if (options?.nowIso && options.nowIso >= cutoffAt) {
    throw new WeeklyPayDomainError("WEEK_CUTOFF", "week cutoff passed");
  }

  const remainingByDay = new Map<string, number>();
  const items: WeeklyPayCalcItemResult[] = [];

  for (const rec of sorted) {
    if (rec.status !== "confirmed" && rec.status !== "locked") {
      throw new WeeklyPayDomainError(
        "INVALID_SELECTION",
        "only confirmed or locked work records are eligible",
      );
    }
    if (!rec.employmentTermId || rec.hourlyWageSnapshotYen == null) {
      throw new WeeklyPayDomainError("NO_WAGE", "work record has no wage snapshot");
    }
    if (weekStartFor(rec.workDate, policy.weekStartIsoDow) !== weekStart) {
      throw new WeeklyPayDomainError("CROSS_WEEK", "work records must be in the same week");
    }
    if (today && rec.workDate > today) {
      throw new WeeklyPayDomainError("FUTURE_WORK_DATE", "future work_date is not allowed");
    }

    let eligibleMinutes: number;
    if (policy.dailyCapScope === "per_work_record") {
      eligibleMinutes = Math.min(rec.workedMinutes, policy.dailyCapMinutes);
    } else {
      const remaining = remainingByDay.get(rec.workDate) ?? policy.dailyCapMinutes;
      eligibleMinutes = Math.min(rec.workedMinutes, remaining);
      remainingByDay.set(rec.workDate, remaining - eligibleMinutes);
    }

    const { rawAmountYen, eligibleAmountYen } = calculateItemAmountYen({
      hourlyWageYen: rec.hourlyWageSnapshotYen,
      eligibleMinutes,
      advanceRateBps: policy.advanceRateBps,
      roundingUnitYen: policy.roundingUnitYen,
      includeTransportFee: policy.includeTransportFee,
      transportFeeYen: rec.transportFeeYen,
    });

    const formula =
      "floor((hourly_wage_yen * eligible_minutes * advance_rate_bps / 600000) / rounding_unit_yen) * rounding_unit_yen" +
      (policy.includeTransportFee ? " + transport_fee_yen(before rounding)" : "");

    const calculationTrace: WeeklyPayItemCalculationTrace = {
      workedMinutes: rec.workedMinutes,
      dailyCapMinutes: policy.dailyCapMinutes,
      dailyCapScope: policy.dailyCapScope,
      eligibleMinutes,
      hourlyWageYen: rec.hourlyWageSnapshotYen,
      advanceRateBps: policy.advanceRateBps,
      includeTransportFee: policy.includeTransportFee,
      transportFeeYen: rec.transportFeeYen,
      rawAmountYen,
      roundingUnitYen: policy.roundingUnitYen,
      eligibleAmountYen,
      formula,
    };

    items.push({
      workRecordId: rec.id,
      workDate: rec.workDate,
      workedMinutes: rec.workedMinutes,
      eligibleMinutes,
      hourlyWageYen: rec.hourlyWageSnapshotYen,
      employmentTermId: rec.employmentTermId,
      transportFeeYen: rec.transportFeeYen,
      workRecordRevisionNo: rec.revisionNo,
      eligibleAmountYen,
      calculationTrace,
    });
  }

  const totalAmountYen = items.reduce((sum, i) => sum + i.eligibleAmountYen, 0);
  if (totalAmountYen <= 0) {
    throw new WeeklyPayDomainError("ZERO_AMOUNT", "total eligible amount must be > 0");
  }

  return {
    weekStart,
    weekEnd,
    cutoffAt,
    paymentDate,
    totalAmountYen,
    items,
  };
}

export function defaultPhase4PolicySnapshot(
  policyId: string,
  version: number,
): WeeklyPayPolicySnapshot {
  return {
    policyId,
    version,
    advanceRateBps: 7000,
    dailyCapMinutes: 480,
    dailyCapScope: "per_calendar_day" satisfies WeeklyPayDailyCapScope,
    roundingUnitYen: 500,
    includeTransportFee: false,
    weekStartIsoDow: 1,
    paymentOffsetDays: 11,
  };
}
