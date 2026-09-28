import { describe, expect, it } from "vitest";
import { WorkDomainError } from "./work-errors.js";
import type { EmploymentTerm } from "./work-types.js";
import type { Shift } from "./types.js";
import {
  areInclusiveRangesAdjacent,
  assertActiveTermsDoNotOverlap,
  assertConfirmEndNotFuture,
  assertHourlyWage,
  assertInclusiveTermRange,
  assertTransportFee,
  computeWorkedMinutes,
  findActiveTermForDate,
  inclusiveDateRangesOverlap,
  nextRevisionNo,
  prefillDraftFromShift,
  assertWageSnapshotIntegrity,
  employmentTermLockScope,
  CONFIRM_WORK_RECORD_LOCK_ORDER,
  EMPLOYMENT_TERM_LOCK_ORDER,
  EMPLOYMENT_TERM_LOCK_RPCS,
  wageSnapshotOnConfirm,
  workRecordTimeRangesOverlap,
} from "./work-validation.js";
import { allowsMultipleWorkRecordsSameDay } from "./work-lifecycle.js";

function term(
  overrides: Partial<EmploymentTerm> = {},
): EmploymentTerm {
  return {
    id: "term-1",
    orgId: "org-1",
    staffId: "staff-1",
    hourlyWageYen: 1200,
    effectiveFrom: "2026-09-01",
    effectiveTo: "2026-09-30",
    createdByStaffId: "mgr-1",
    createdAt: "2026-08-01T00:00:00.000Z",
    revokedAt: null,
    revokedByStaffId: null,
    revokeReason: null,
    updatedAt: null,
    ...overrides,
  };
}

function shift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: "shift-1",
    orgId: "org-1",
    staffId: "staff-1",
    workDate: "2026-09-10",
    startTime: "10:00",
    endTime: "19:00",
    endDayOffset: 0,
    workLocationId: "loc-1",
    source: "internal",
    sourceRequestDateId: null,
    externalRef: null,
    status: "published",
    note: null,
    preReportUrl: null,
    timeUnspecified: false,
    publishedAt: "2026-09-01T00:00:00.000Z",
    publishedByStaffId: "mgr-1",
    cancelledAt: null,
    cancelledByStaffId: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("employment term inclusive dates", () => {
  it("treats effective_to as inclusive", () => {
    expect(
      inclusiveDateRangesOverlap("2026-09-01", "2026-09-30", "2026-09-30", "2026-09-30"),
    ).toBe(true);
    expect(
      inclusiveDateRangesOverlap("2026-09-01", "2026-09-30", "2026-10-01", null),
    ).toBe(false);
  });

  it("allows adjacent terms", () => {
    expect(areInclusiveRangesAdjacent("2026-09-30", "2026-10-01")).toBe(true);
    expect(() =>
      assertActiveTermsDoNotOverlap(
        { effectiveFrom: "2026-10-01", effectiveTo: null },
        [term()],
      ),
    ).not.toThrow();
  });

  it("rejects overlapping closed terms", () => {
    expect(() =>
      assertActiveTermsDoNotOverlap(
        { effectiveFrom: "2026-09-15", effectiveTo: "2026-10-15" },
        [term()],
      ),
    ).toThrow(WorkDomainError);
  });

  it("rejects open-ended overlap", () => {
    expect(() =>
      assertActiveTermsDoNotOverlap(
        { effectiveFrom: "2026-08-01", effectiveTo: null },
        [term({ effectiveFrom: "2026-09-01", effectiveTo: null })],
      ),
    ).toThrow(/cannot overlap/);
  });

  it("ignores revoked terms when checking overlap", () => {
    expect(() =>
      assertActiveTermsDoNotOverlap(
        { effectiveFrom: "2026-09-01", effectiveTo: "2026-09-30" },
        [term({ revokedAt: "2026-08-15T00:00:00.000Z" })],
      ),
    ).not.toThrow();
  });

  it("rejects effective_to before effective_from", () => {
    expect(() => assertInclusiveTermRange("2026-09-30", "2026-09-01")).toThrow(
      WorkDomainError,
    );
  });

  it("rejects non-positive hourly wage", () => {
    expect(() => assertHourlyWage(0)).toThrow(WorkDomainError);
    expect(() => assertHourlyWage(-1)).toThrow(WorkDomainError);
    expect(assertHourlyWage(1300)).toBe(1300);
  });
});

describe("work record duration", () => {
  it("computes same-day duration", () => {
    expect(
      computeWorkedMinutes({
        workDate: "2026-09-10",
        startTime: "10:00",
        endTime: "19:00",
        endDayOffset: 0,
        breakMinutes: 60,
      }),
    ).toBe(480);
  });

  it("computes overnight duration", () => {
    expect(
      computeWorkedMinutes({
        workDate: "2026-09-10",
        startTime: "22:00",
        endTime: "06:00",
        endDayOffset: 1,
        breakMinutes: 30,
      }),
    ).toBe(450);
  });

  it("rejects break covering the whole span", () => {
    expect(() =>
      computeWorkedMinutes({
        workDate: "2026-09-10",
        startTime: "10:00",
        endTime: "11:00",
        endDayOffset: 0,
        breakMinutes: 60,
      }),
    ).toThrow(/breakMinutes/);
  });

  it("rejects negative transport", () => {
    expect(() => assertTransportFee(-1)).toThrow(WorkDomainError);
  });

  it("allows multiple records on the same day when ranges do not overlap", () => {
    expect(allowsMultipleWorkRecordsSameDay()).toBe(true);
    expect(
      workRecordTimeRangesOverlap(
        {
          workDate: "2026-09-10",
          startTime: "09:00",
          endTime: "13:00",
          endDayOffset: 0,
        },
        {
          workDate: "2026-09-10",
          startTime: "13:00",
          endTime: "18:00",
          endDayOffset: 0,
        },
      ),
    ).toBe(false);
    expect(
      workRecordTimeRangesOverlap(
        {
          workDate: "2026-09-10",
          startTime: "09:00",
          endTime: "14:00",
          endDayOffset: 0,
        },
        {
          workDate: "2026-09-10",
          startTime: "13:00",
          endTime: "18:00",
          endDayOffset: 0,
        },
      ),
    ).toBe(true);
  });
});

describe("future confirm gate", () => {
  it("allows a future draft (no confirm check)", () => {
    expect(
      computeWorkedMinutes({
        workDate: "2099-01-01",
        startTime: "10:00",
        endTime: "18:00",
        endDayOffset: 0,
        breakMinutes: 0,
      }),
    ).toBe(480);
  });

  it("denies confirming a future end datetime in Asia/Tokyo", () => {
    expect(() =>
      assertConfirmEndNotFuture(
        {
          workDate: "2099-01-01",
          endTime: "18:00",
          endDayOffset: 0,
        },
        new Date("2026-09-25T00:00:00+09:00"),
      ),
    ).toThrow(WorkDomainError);
  });

  it("allows confirming a past end datetime", () => {
    expect(() =>
      assertConfirmEndNotFuture(
        {
          workDate: "2026-09-01",
          endTime: "18:00",
          endDayOffset: 0,
        },
        new Date("2026-09-25T00:00:00+09:00"),
      ),
    ).not.toThrow();
  });
});

describe("shift prefill is not source of truth", () => {
  it("copies times from a shift but lets the draft diverge", () => {
    const prefilled = prefillDraftFromShift(shift());
    expect(prefilled.startTime).toBe("10:00");
    expect(prefilled.endTime).toBe("19:00");
    expect(prefilled.sourceShiftId).toBe("shift-1");
    const edited = computeWorkedMinutes({
      workDate: prefilled.workDate,
      startTime: "10:05",
      endTime: "19:03",
      endDayOffset: 0,
      breakMinutes: 0,
    });
    expect(edited).toBe(538);
    expect(shift().startTime).toBe("10:00");
    expect(shift().endTime).toBe("19:00");
  });
});

describe("wage snapshot", () => {
  it("snapshots the matching active term", () => {
    const found = findActiveTermForDate(
      [term(), term({ id: "term-2", effectiveFrom: "2026-10-01", effectiveTo: null })],
      "2026-09-15",
    );
    expect(wageSnapshotOnConfirm(found)).toEqual({
      employmentTermId: "term-1",
      hourlyWageSnapshotYen: 1200,
    });
  });

  it("confirms without a wage when no term exists", () => {
    expect(wageSnapshotOnConfirm(findActiveTermForDate([], "2026-09-15"))).toEqual({
      employmentTermId: null,
      hourlyWageSnapshotYen: null,
    });
  });

  it("rejects a wrong-date employment_term_id", () => {
    expect(() =>
      assertWageSnapshotIntegrity({
        orgId: "org-1",
        staffId: "staff-1",
        workDate: "2026-10-15",
        employmentTermId: "term-1",
        hourlyWageSnapshotYen: 1200,
        confirmedAt: "2026-10-15T12:00:00.000Z",
        term: term(),
      }),
    ).toThrow(/outside the employment term/);
  });

  it("rejects a snapshot value mismatch", () => {
    expect(() =>
      assertWageSnapshotIntegrity({
        orgId: "org-1",
        staffId: "staff-1",
        workDate: "2026-09-15",
        employmentTermId: "term-1",
        hourlyWageSnapshotYen: 9999,
        confirmedAt: "2026-09-15T12:00:00.000Z",
        term: term(),
      }),
    ).toThrow(WorkDomainError);
  });

  it("rejects same staff/org but a different period term", () => {
    expect(() =>
      assertWageSnapshotIntegrity({
        orgId: "org-1",
        staffId: "staff-1",
        workDate: "2026-08-15",
        employmentTermId: "term-1",
        hourlyWageSnapshotYen: 1200,
        confirmedAt: "2026-08-15T12:00:00.000Z",
        term: term(),
      }),
    ).toThrow(/outside the employment term/);
  });

  it("rejects a new snapshot against an already revoked term", () => {
    const revoked = term({ revokedAt: "2026-09-10T00:00:00.000Z" });
    expect(() =>
      assertWageSnapshotIntegrity({
        orgId: "org-1",
        staffId: "staff-1",
        workDate: "2026-09-15",
        employmentTermId: "term-1",
        hourlyWageSnapshotYen: 1200,
        confirmedAt: "2026-09-15T12:00:00.000Z",
        term: revoked,
      }),
    ).toThrow(/revoked/);
  });

  it("keeps a revoke-before historical confirmed snapshot valid", () => {
    expect(() =>
      assertWageSnapshotIntegrity({
        orgId: "org-1",
        staffId: "staff-1",
        workDate: "2026-09-15",
        employmentTermId: "term-1",
        hourlyWageSnapshotYen: 1200,
        confirmedAt: "2026-09-05T00:00:00.000Z",
        term: term({ revokedAt: "2026-09-10T00:00:00.000Z" }),
      }),
    ).not.toThrow();
  });

  it("does not snapshot an inapplicable term after close+insert replacement", () => {
    const closed = term({ effectiveFrom: "2026-08-01", effectiveTo: "2026-08-31" });
    const next = term({
      id: "term-2",
      effectiveFrom: "2026-09-01",
      effectiveTo: null,
      hourlyWageYen: 1600,
    });
    expect(findActiveTermForDate([closed, next], "2026-08-05")?.id).toBe("term-1");
    expect(findActiveTermForDate([closed, next], "2026-09-05")?.hourlyWageYen).toBe(1600);
    expect(findActiveTermForDate([closed, next], "2026-09-05")?.id).not.toBe("term-1");
  });
});

describe("employment term lock scope", () => {
  it("uses one org+staff scope for create, revoke, and confirm", () => {
    expect(EMPLOYMENT_TERM_LOCK_RPCS).toEqual([
      "create_employment_term",
      "revoke_employment_term",
      "confirm_work_record",
    ]);
    expect(employmentTermLockScope("org-1", "staff-1")).toBe("org-1:term:staff-1");
    expect(employmentTermLockScope("org-1", "staff-1")).toBe(
      employmentTermLockScope("org-1", "staff-1"),
    );
  });

  it("fixes the canonical lock order: advisory before any FOR UPDATE", () => {
    expect(EMPLOYMENT_TERM_LOCK_ORDER).toEqual([
      "read_org_staff_unlocked",
      "advisory_term_scope",
      "select_for_update",
      "revalidate_after_lock",
      "mutate_or_snapshot",
    ]);
    expect(EMPLOYMENT_TERM_LOCK_ORDER.indexOf("advisory_term_scope")).toBeLessThan(
      EMPLOYMENT_TERM_LOCK_ORDER.indexOf("select_for_update"),
    );
    expect(CONFIRM_WORK_RECORD_LOCK_ORDER).toEqual([
      "select_work_record_unlocked",
      "advisory_term_scope",
      "select_work_record_for_update",
      "revalidate_status_org_staff_permission",
      "select_active_employment_term",
      "snapshot",
    ]);
    expect(CONFIRM_WORK_RECORD_LOCK_ORDER.indexOf("advisory_term_scope")).toBeLessThan(
      CONFIRM_WORK_RECORD_LOCK_ORDER.indexOf("select_work_record_for_update"),
    );
  });
});

describe("revision numbering", () => {
  it("starts at 1 and increments past the current max", () => {
    expect(nextRevisionNo([])).toBe(1);
    expect(nextRevisionNo([1, 3])).toBe(4);
  });
});
