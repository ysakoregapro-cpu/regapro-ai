import { describe, expect, it } from "vitest";
import { ShiftDomainError } from "@regapro/work";
import {
  classifyThrown,
  publicErrorMessage,
} from "@/lib/application/api-errors";

describe("api-errors", () => {
  it("maps session/JWT failures to UNAUTHENTICATED", () => {
    expect(classifyThrown(new Error("JWT expired"))).toBe("UNAUTHENTICATED");
    expect(publicErrorMessage("UNAUTHENTICATED")).not.toMatch(/JWT|PostgREST/i);
  });

  it("maps RLS / permission failures to FORBIDDEN", () => {
    expect(classifyThrown(new Error("new row violates row-level security policy"))).toBe(
      "FORBIDDEN",
    );
    expect(publicErrorMessage("FORBIDDEN")).not.toMatch(/row-level|42501/i);
  });

  it("maps missing rows to NOT_FOUND", () => {
    expect(classifyThrown(new Error("PGRST116"))).toBe("NOT_FOUND");
  });

  it("maps Shift Domain errors without leaking table names", () => {
    expect(classifyThrown(new ShiftDomainError("ONE_SIDED_TIME", "x"))).toBe(
      "VALIDATION",
    );
    expect(classifyThrown(new ShiftDomainError("FORBIDDEN", "x"))).toBe("FORBIDDEN");
    expect(classifyThrown(new ShiftDomainError("INVALID_TRANSITION", "x"))).toBe(
      "CONFLICT",
    );
    expect(classifyThrown(new Error("SHIFT_FORBIDDEN: shift.request required"))).toBe(
      "FORBIDDEN",
    );
    expect(publicErrorMessage("VALIDATION")).not.toMatch(/shift_requests|staff_id/i);
  });

  it("does not surface DB internals in public messages", () => {
    expect(publicErrorMessage("INTERNAL")).toMatch(/失敗しました/);
    expect(publicErrorMessage("INTERNAL")).not.toMatch(/supabase|postgres|column/i);
  });
});
