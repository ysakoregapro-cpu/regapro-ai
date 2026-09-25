import { describe, expect, it } from "vitest";
import { ShiftDomainError } from "./errors.js";
import {
  assertEndDayOffset,
  assertExternalRef,
  assertPreferenceDate,
  assertPreReportUrl,
  assertRequestPeriod,
  assertShiftSchedule,
  assertTimePair,
  assertUniqueDates,
  isTimeUnspecified,
  nextRequestVersion,
} from "./validation.js";
import { allowsMultipleShiftsSameDay } from "./shift-lifecycle.js";

describe("request period validation", () => {
  it("accepts a single-day period", () => {
    expect(() => assertRequestPeriod("2026-10-01", "2026-10-01")).not.toThrow();
  });

  it("rejects end before start", () => {
    expect(() => assertRequestPeriod("2026-10-31", "2026-10-01")).toThrow(ShiftDomainError);
    try {
      assertRequestPeriod("2026-10-31", "2026-10-01");
    } catch (err) {
      expect(err).toBeInstanceOf(ShiftDomainError);
      expect((err as ShiftDomainError).code).toBe("INVALID_PERIOD");
    }
  });

  it("rejects an impossible calendar date", () => {
    expect(() => assertRequestPeriod("2026-02-30", "2026-03-01")).toThrow(ShiftDomainError);
  });
});

describe("one preference per date", () => {
  it("rejects two rows for the same work date", () => {
    expect(() =>
      assertUniqueDates([
        { workDate: "2026-10-01" },
        { workDate: "2026-10-01" },
      ]),
    ).toThrowError(/one preference/);
  });

  it("allows distinct dates", () => {
    expect(() =>
      assertUniqueDates([{ workDate: "2026-10-01" }, { workDate: "2026-10-02" }]),
    ).not.toThrow();
  });
});

describe("hope_work / hope_off", () => {
  it("accepts hope_work with no time (時間指定なし)", () => {
    const row = assertPreferenceDate(
      { workDate: "2026-10-05", preferenceType: "hope_work" },
      "2026-10-01",
      "2026-10-31",
    );
    expect(row.timeUnspecified).toBe(true);
  });

  it("accepts hope_work with location only", () => {
    const row = assertPreferenceDate(
      {
        workDate: "2026-10-05",
        preferenceType: "hope_work",
        workLocationId: "11111111-1111-4111-8111-111111111111",
      },
      "2026-10-01",
      "2026-10-31",
    );
    expect(row.timeUnspecified).toBe(true);
    expect(row.workLocationId).toBeTruthy();
  });

  it("accepts hope_work with time only", () => {
    const row = assertPreferenceDate(
      {
        workDate: "2026-10-05",
        preferenceType: "hope_work",
        startTime: "09:00",
        endTime: "18:00",
      },
      "2026-10-01",
      "2026-10-31",
    );
    expect(row.timeUnspecified).toBe(false);
  });

  it("accepts hope_off without schedule", () => {
    const row = assertPreferenceDate(
      { workDate: "2026-10-06", preferenceType: "hope_off" },
      "2026-10-01",
      "2026-10-31",
    );
    expect(row.preferenceType).toBe("hope_off");
  });

  it("rejects hope_off with a time", () => {
    expect(() =>
      assertPreferenceDate(
        {
          workDate: "2026-10-06",
          preferenceType: "hope_off",
          startTime: "09:00",
          endTime: "18:00",
        },
        "2026-10-01",
        "2026-10-31",
      ),
    ).toThrow(ShiftDomainError);
  });

  it("rejects a date outside the period", () => {
    try {
      assertPreferenceDate(
        { workDate: "2026-11-01", preferenceType: "hope_work" },
        "2026-10-01",
        "2026-10-31",
      );
      throw new Error("expected DATE_OUT_OF_PERIOD");
    } catch (err) {
      expect(err).toBeInstanceOf(ShiftDomainError);
      expect((err as ShiftDomainError).code).toBe("DATE_OUT_OF_PERIOD");
    }
  });
});

describe("time unspecified", () => {
  it("is derived from both times being null", () => {
    expect(isTimeUnspecified(null, null)).toBe(true);
    expect(isTimeUnspecified("09:00", "18:00")).toBe(false);
    expect(assertTimePair(null, null).timeUnspecified).toBe(true);
  });
});

describe("one-sided time rejected", () => {
  it("rejects start without end", () => {
    expect(() => assertTimePair("09:00", null)).toThrow(ShiftDomainError);
    try {
      assertTimePair("09:00", null);
    } catch (err) {
      expect((err as ShiftDomainError).code).toBe("ONE_SIDED_TIME");
    }
  });

  it("rejects end without start", () => {
    expect(() => assertTimePair(null, "18:00")).toThrow(ShiftDomainError);
  });
});

describe("overnight offset validation", () => {
  it("allows offset 0 or 1 when times are set", () => {
    expect(assertEndDayOffset(0, true)).toBe(0);
    expect(assertEndDayOffset(1, true)).toBe(1);
  });

  it("rejects offset 1 without times", () => {
    expect(() => assertEndDayOffset(1, false)).toThrow(ShiftDomainError);
  });

  it("rejects any other offset", () => {
    expect(() => assertEndDayOffset(2, true)).toThrow(ShiftDomainError);
  });
});

describe("shift schedule integrity", () => {
  it("rejects same-day end before or equal to start", () => {
    expect(() => assertShiftSchedule("10:00", "09:00", 0)).toThrow(ShiftDomainError);
    expect(() => assertShiftSchedule("10:00", "10:00", 0)).toThrow(ShiftDomainError);
  });

  it("accepts overnight with offset 1 even when end is earlier", () => {
    const row = assertShiftSchedule("22:00", "06:00", 1);
    expect(row.endDayOffset).toBe(1);
    expect(row.timeUnspecified).toBe(false);
  });

  it("rejects time-unspecified with overnight offset", () => {
    expect(() => assertShiftSchedule(null, null, 1)).toThrow(ShiftDomainError);
  });
});

describe("multiple shifts same day", () => {
  it("is allowed by the domain (no 1-staff-1-day unique)", () => {
    expect(allowsMultipleShiftsSameDay()).toBe(true);
  });
});

describe("external_ref idempotency rules", () => {
  it("accepts adapter keys", () => {
    expect(assertExternalRef("spreadsheet", "sheet:shifts-2026!R12")).toBe(
      "sheet:shifts-2026!R12",
    );
  });

  it("rejects a person name as external_ref", () => {
    expect(() => assertExternalRef("spreadsheet", "山田 太郎")).toThrow(ShiftDomainError);
    expect(() => assertExternalRef("imported", "今川")).toThrow(ShiftDomainError);
  });

  it("treats empty as absent", () => {
    expect(assertExternalRef("internal", null)).toBeNull();
    expect(assertExternalRef("internal", "")).toBeNull();
  });
});

describe("pre-report URL", () => {
  it("accepts an https URL and allows absence", () => {
    expect(assertPreReportUrl(null)).toBeNull();
    expect(assertPreReportUrl("https://forms.example.com/pre")).toBe(
      "https://forms.example.com/pre",
    );
  });

  it("rejects a non-http scheme", () => {
    expect(() => assertPreReportUrl("javascript:alert(1)")).toThrow(ShiftDomainError);
  });
});

describe("request versioning", () => {
  it("starts at 1 and increments from the max", () => {
    expect(nextRequestVersion([])).toBe(1);
    expect(nextRequestVersion([1, 3])).toBe(4);
  });
});
