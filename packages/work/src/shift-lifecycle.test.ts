import { describe, expect, it } from "vitest";
import { ShiftDomainError } from "./errors.js";
import {
  assertShiftMutable,
  canTransitionShift,
  isShiftVisibleToOwner,
  planCancelShift,
  planPublishShift,
} from "./shift-lifecycle.js";
import type { Shift } from "./types.js";

function shift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: "shift-1",
    orgId: "org-1",
    staffId: "staff-1",
    workDate: "2026-10-10",
    startTime: "10:00",
    endTime: "18:00",
    endDayOffset: 0,
    workLocationId: null,
    source: "internal",
    sourceRequestDateId: null,
    externalRef: null,
    status: "draft",
    note: null,
    preReportUrl: null,
    timeUnspecified: false,
    publishedAt: null,
    publishedByStaffId: null,
    cancelledAt: null,
    cancelledByStaffId: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("published / cancelled shift lifecycle", () => {
  it("publishes a draft and is idempotent when already published", () => {
    expect(canTransitionShift("draft", "published")).toBe(true);
    expect(planPublishShift(shift({ status: "draft" })).kind).toBe("publish");
    expect(planPublishShift(shift({ status: "published" })).kind).toBe("idempotent");
  });

  it("does not publish a cancelled shift", () => {
    expect(() => planPublishShift(shift({ status: "cancelled" }))).toThrow(
      ShiftDomainError,
    );
  });

  it("cancels draft or published and is idempotent when already cancelled", () => {
    expect(planCancelShift(shift({ status: "draft" })).kind).toBe("cancel");
    expect(planCancelShift(shift({ status: "published" })).kind).toBe("cancel");
    expect(planCancelShift(shift({ status: "cancelled" })).kind).toBe("idempotent");
  });

  it("hides draft and cancelled from the owner view", () => {
    expect(isShiftVisibleToOwner("published")).toBe(true);
    expect(isShiftVisibleToOwner("draft")).toBe(false);
    expect(isShiftVisibleToOwner("cancelled")).toBe(false);
  });

  it("locks published and cancelled content", () => {
    expect(() => assertShiftMutable("published")).toThrow(ShiftDomainError);
    expect(() => assertShiftMutable("cancelled")).toThrow(ShiftDomainError);
  });
});
