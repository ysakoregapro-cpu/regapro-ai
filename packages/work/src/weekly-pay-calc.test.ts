import { describe, expect, it } from "vitest";
import {
  calculateItemAmountYen,
  calculateWeeklyPayForRecords,
  cutoffAtForWeek,
  defaultPhase4PolicySnapshot,
  paymentDateForWeek,
  weekEndFor,
  weekStartFor,
} from "./weekly-pay-calc.js";
import type { WeeklyPayWorkRecordInput } from "./weekly-pay-types.js";

const policy = defaultPhase4PolicySnapshot("policy-1", 1);

function wr(
  partial: Partial<WeeklyPayWorkRecordInput> & Pick<WeeklyPayWorkRecordInput, "id" | "workDate">,
): WeeklyPayWorkRecordInput {
  return {
    startTime: "10:00:00",
    endTime: "19:00:00",
    endDayOffset: 0,
    workedMinutes: 480,
    transportFeeYen: 500,
    status: "confirmed",
    employmentTermId: "term-1",
    hourlyWageSnapshotYen: 1200,
    revisionNo: 1,
    ...partial,
  };
}

describe("weekly pay week boundaries", () => {
  it("uses Monday–Sunday ISO weeks", () => {
    expect(weekStartFor("2026-08-09")).toBe("2026-08-03"); // Sunday → prior Monday
    expect(weekStartFor("2026-08-03")).toBe("2026-08-03");
    expect(weekEndFor("2026-08-03")).toBe("2026-08-09");
    expect(paymentDateForWeek("2026-08-03", 11)).toBe("2026-08-14"); // Friday after Sunday
    expect(cutoffAtForWeek("2026-08-03")).toBe("2026-08-10T00:00:00+09:00");
  });
});

describe("calculateItemAmountYen (old SQL parity)", () => {
  it("matches ((wage * min(minutes,480) * 70) / 6000 / 500) * 500", () => {
    // 1200 * 480 * 70 / 6000 = 6720 → floor to 500 = 6500
    const a = calculateItemAmountYen({
      hourlyWageYen: 1200,
      eligibleMinutes: 480,
      advanceRateBps: 7000,
      roundingUnitYen: 500,
      includeTransportFee: false,
      transportFeeYen: 500,
    });
    expect(a.rawAmountYen).toBe(6720);
    expect(a.eligibleAmountYen).toBe(6500);
  });

  it("excludes transport by default", () => {
    const withTransportIgnored = calculateItemAmountYen({
      hourlyWageYen: 1000,
      eligibleMinutes: 60,
      advanceRateBps: 7000,
      roundingUnitYen: 500,
      includeTransportFee: false,
      transportFeeYen: 1000,
    });
    // 1000*60*7000/600000 = 700 → floor 500 = 500
    expect(withTransportIgnored.eligibleAmountYen).toBe(500);
  });

  it("floors partial units to zero when below rounding unit", () => {
    const a = calculateItemAmountYen({
      hourlyWageYen: 1000,
      eligibleMinutes: 30,
      advanceRateBps: 7000,
      roundingUnitYen: 500,
      includeTransportFee: false,
      transportFeeYen: 0,
    });
    // 1000*30*7000/600000 = 350 → 0
    expect(a.eligibleAmountYen).toBe(0);
  });
});

describe("calculateWeeklyPayForRecords", () => {
  it("caps a single long day at 480 minutes", () => {
    const result = calculateWeeklyPayForRecords(
      [wr({ id: "a", workDate: "2026-08-04", workedMinutes: 600 })],
      policy,
      { today: "2026-08-08" },
    );
    expect(result.items[0].eligibleMinutes).toBe(480);
    expect(result.totalAmountYen).toBe(6500);
    expect(result.weekStart).toBe("2026-08-03");
  });

  it("allocates daily cap across multiple same-day records chronologically", () => {
    const result = calculateWeeklyPayForRecords(
      [
        wr({
          id: "late",
          workDate: "2026-08-04",
          startTime: "18:00:00",
          endTime: "22:00:00",
          workedMinutes: 240,
        }),
        wr({
          id: "early",
          workDate: "2026-08-04",
          startTime: "09:00:00",
          endTime: "15:00:00",
          workedMinutes: 360,
        }),
      ],
      policy,
      { today: "2026-08-08" },
    );
    expect(result.items.map((i) => i.workRecordId)).toEqual(["early", "late"]);
    expect(result.items[0].eligibleMinutes).toBe(360);
    expect(result.items[1].eligibleMinutes).toBe(120); // 480 - 360
  });

  it("does not share cap across different calendar days", () => {
    const result = calculateWeeklyPayForRecords(
      [
        wr({ id: "d1", workDate: "2026-08-04", workedMinutes: 480 }),
        wr({ id: "d2", workDate: "2026-08-05", workedMinutes: 480 }),
      ],
      policy,
      { today: "2026-08-08" },
    );
    expect(result.items[0].eligibleMinutes).toBe(480);
    expect(result.items[1].eligibleMinutes).toBe(480);
    expect(result.totalAmountYen).toBe(13000);
  });

  it("rejects cross-week selections", () => {
    expect(() =>
      calculateWeeklyPayForRecords(
        [
          wr({ id: "a", workDate: "2026-08-09" }), // Sunday week A
          wr({ id: "b", workDate: "2026-08-10" }), // Monday week B
        ],
        policy,
        { today: "2026-08-12" },
      ),
    ).toThrow(/same week/);
  });

  it("rejects after cutoff", () => {
    expect(() =>
      calculateWeeklyPayForRecords(
        [wr({ id: "a", workDate: "2026-08-04" })],
        policy,
        { today: "2026-08-10", nowIso: "2026-08-10T00:00:00+09:00" },
      ),
    ).toThrow(/cutoff/);
  });

  it("rejects missing wage snapshot", () => {
    expect(() =>
      calculateWeeklyPayForRecords(
        [
          wr({
            id: "a",
            workDate: "2026-08-04",
            hourlyWageSnapshotYen: null,
            employmentTermId: null,
          }),
        ],
        policy,
        { today: "2026-08-08" },
      ),
    ).toThrow(/wage snapshot/);
  });

  it("keeps per-item rounding then sums (not week re-round)", () => {
    // Two items each raw 350 → each rounds to 0 → total 0 → ZERO_AMOUNT
    expect(() =>
      calculateWeeklyPayForRecords(
        [
          wr({
            id: "a",
            workDate: "2026-08-04",
            workedMinutes: 30,
            hourlyWageSnapshotYen: 1000,
          }),
          wr({
            id: "b",
            workDate: "2026-08-05",
            workedMinutes: 30,
            hourlyWageSnapshotYen: 1000,
          }),
        ],
        policy,
        { today: "2026-08-08" },
      ),
    ).toThrow(/total eligible amount/);
  });
});
