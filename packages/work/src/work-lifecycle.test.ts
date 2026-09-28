import { describe, expect, it } from "vitest";
import { WorkDomainError } from "./work-errors.js";
import type { WorkRecord } from "./work-types.js";
import {
  assertWorkRecordMutable,
  canTransitionWorkRecord,
  planConfirmWorkRecord,
  planReopenWorkRecord,
  planVoidWorkRecord,
} from "./work-lifecycle.js";

function record(overrides: Partial<WorkRecord> = {}): WorkRecord {
  return {
    id: "wr-1",
    orgId: "org-1",
    staffId: "staff-1",
    workDate: "2026-09-10",
    startTime: "10:00",
    endTime: "19:00",
    endDayOffset: 0,
    breakMinutes: 60,
    workedMinutes: 480,
    transportFeeYen: 0,
    workLocationId: null,
    sourceShiftId: null,
    assignmentSource: null,
    assignmentExternalRef: null,
    status: "draft",
    employmentTermId: null,
    hourlyWageSnapshotYen: null,
    confirmedAt: null,
    confirmedByStaffId: null,
    voidedAt: null,
    voidedByStaffId: null,
    voidReason: null,
    createdByStaffId: "staff-1",
    createdAt: "2026-09-10T01:00:00.000Z",
    updatedAt: "2026-09-10T01:00:00.000Z",
    ...overrides,
  };
}

describe("work record state machine", () => {
  it("confirms a draft and is idempotent when already confirmed", () => {
    expect(planConfirmWorkRecord(record()).kind).toBe("confirm");
    expect(planConfirmWorkRecord(record({ status: "confirmed" })).kind).toBe("idempotent");
  });

  it("treats confirmed records as immutable until reopened", () => {
    expect(() => assertWorkRecordMutable("confirmed")).toThrow(WorkDomainError);
    expect(canTransitionWorkRecord("confirmed", "draft")).toBe(true);
    expect(planReopenWorkRecord(record({ status: "confirmed" }), "訂正").kind).toBe(
      "reopen",
    );
  });

  it("requires a reason to reopen", () => {
    expect(() => planReopenWorkRecord(record({ status: "confirmed" }), "  ")).toThrow(
      /reason/,
    );
  });

  it("keeps locked records immutable", () => {
    expect(() => assertWorkRecordMutable("locked")).toThrow(/locked work records/);
    expect(() => planConfirmWorkRecord(record({ status: "locked" }))).toThrow(
      /locked work records/,
    );
    expect(() => planReopenWorkRecord(record({ status: "locked" }), "x")).toThrow(
      /locked work records/,
    );
    expect(() => planVoidWorkRecord(record({ status: "locked" }), "x")).toThrow(
      /locked work records/,
    );
    expect(canTransitionWorkRecord("locked", "draft")).toBe(false);
  });

  it("voids draft or confirmed and treats voided as terminal", () => {
    expect(planVoidWorkRecord(record(), "誤登録").kind).toBe("void");
    expect(planVoidWorkRecord(record({ status: "confirmed" }), "取消").kind).toBe("void");
    expect(planVoidWorkRecord(record({ status: "voided" }), "再取消").kind).toBe(
      "idempotent",
    );
    expect(canTransitionWorkRecord("voided", "draft")).toBe(false);
  });
});
