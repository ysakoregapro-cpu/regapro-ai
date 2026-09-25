import { describe, expect, it } from "vitest";
import { ShiftDomainError } from "./errors.js";
import {
  assertRequestMutable,
  canTransitionRequest,
  isRequestContentMutable,
  planCancelShiftRequest,
  planSubmitShiftRequest,
  shiftRequestDraftLockScope,
} from "./request-lifecycle.js";
import type { ShiftRequest } from "./types.js";

function request(overrides: Partial<ShiftRequest> = {}): ShiftRequest {
  return {
    id: "req-1",
    orgId: "org-1",
    staffId: "staff-1",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
    version: 1,
    previousRequestId: null,
    status: "draft",
    requestedByStaffId: "staff-1",
    submittedAt: null,
    cancelledAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    dates: [],
    ...overrides,
  };
}

describe("submitted request immutable", () => {
  it("allows editing a draft only", () => {
    expect(isRequestContentMutable("draft")).toBe(true);
    expect(isRequestContentMutable("submitted")).toBe(false);
    expect(isRequestContentMutable("superseded")).toBe(false);
    expect(isRequestContentMutable("cancelled")).toBe(false);
    expect(() => assertRequestMutable("submitted")).toThrow(ShiftDomainError);
  });
});

describe("supersede lifecycle", () => {
  it("plans submitted -> superseded then draft -> submitted", () => {
    expect(canTransitionRequest("draft", "submitted")).toBe(true);
    expect(canTransitionRequest("submitted", "superseded")).toBe(true);
    const current = request({ id: "req-2", version: 2, status: "draft" });
    const existing = request({ id: "req-1", status: "submitted" });
    const plan = planSubmitShiftRequest(current, existing);
    expect(plan.kind).toBe("submit");
    if (plan.kind === "submit") {
      expect(plan.supersede?.id).toBe("req-1");
    }
  });

  it("is idempotent when the same request is already submitted", () => {
    const submitted = request({ status: "submitted" });
    const plan = planSubmitShiftRequest(submitted, submitted);
    expect(plan.kind).toBe("idempotent");
  });

  it("rejects submit from superseded or cancelled", () => {
    expect(() =>
      planSubmitShiftRequest(request({ status: "superseded" }), null),
    ).toThrow(ShiftDomainError);
    expect(() =>
      planSubmitShiftRequest(request({ status: "cancelled" }), null),
    ).toThrow(ShiftDomainError);
  });
});

describe("draft version lock scope", () => {
  it("uses one transaction lock identity per staff period", () => {
    const a = shiftRequestDraftLockScope({
      orgId: "org-1",
      staffId: "staff-1",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
    });
    const same = shiftRequestDraftLockScope({
      orgId: "org-1",
      staffId: "staff-1",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
    });
    const other = shiftRequestDraftLockScope({
      orgId: "org-1",
      staffId: "staff-1",
      periodStart: "2026-11-01",
      periodEnd: "2026-11-30",
    });
    expect(a).toBe(same);
    expect(a).not.toBe(other);
  });
});

describe("cancelled lifecycle", () => {
  it("cancels draft or submitted and is idempotent when already cancelled", () => {
    expect(planCancelShiftRequest(request({ status: "draft" })).kind).toBe("cancel");
    expect(planCancelShiftRequest(request({ status: "submitted" })).kind).toBe(
      "cancel",
    );
    expect(planCancelShiftRequest(request({ status: "cancelled" })).kind).toBe(
      "idempotent",
    );
  });

  it("does not cancel a superseded request", () => {
    expect(() =>
      planCancelShiftRequest(request({ status: "superseded" })),
    ).toThrow(ShiftDomainError);
  });
});
