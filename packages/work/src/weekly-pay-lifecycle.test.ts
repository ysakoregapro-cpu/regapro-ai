import { describe, expect, it } from "vitest";
import {
  assertNotSelfReview,
  assertReturnReason,
  assertWeeklyPayTransition,
} from "./weekly-pay-lifecycle.js";

describe("weekly pay lifecycle", () => {
  it("allows draft→submitted, submitted→returned/approved, returned→submitted", () => {
    expect(() => assertWeeklyPayTransition("draft", "submitted")).not.toThrow();
    expect(() => assertWeeklyPayTransition("submitted", "returned")).not.toThrow();
    expect(() => assertWeeklyPayTransition("submitted", "approved")).not.toThrow();
    expect(() => assertWeeklyPayTransition("returned", "submitted")).not.toThrow();
  });

  it("rejects paid and other illegal transitions", () => {
    expect(() => assertWeeklyPayTransition("approved", "submitted")).toThrow(
      /invalid status transition/,
    );
    expect(() => assertWeeklyPayTransition("draft", "approved")).toThrow(
      /invalid status transition/,
    );
  });

  it("blocks self review", () => {
    expect(() => assertNotSelfReview("staff-1", "staff-1")).toThrow(/own weekly application/);
    expect(() => assertNotSelfReview("staff-1", "staff-2")).not.toThrow();
  });

  it("validates return reason length", () => {
    expect(() => assertReturnReason("no")).toThrow(/too short/);
    expect(assertReturnReason("  fix hours  ")).toBe("fix hours");
  });
});
