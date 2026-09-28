import { describe, expect, it } from "vitest";
import { ShiftDomainError, WorkDomainError } from "@regapro/work";
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

  it("maps Work Domain errors without leaking wage or table names", () => {
    expect(classifyThrown(new WorkDomainError("INVALID_BREAK", "x"))).toBe("VALIDATION");
    expect(classifyThrown(new WorkDomainError("FORBIDDEN", "x"))).toBe("FORBIDDEN");
    expect(classifyThrown(new WorkDomainError("TERM_OVERLAP", "x"))).toBe("CONFLICT");
    expect(classifyThrown(new WorkDomainError("LOCKED_IMMUTABLE", "x"))).toBe("CONFLICT");
    expect(classifyThrown(new Error("WORK_FORBIDDEN: work_record.submit required"))).toBe(
      "FORBIDDEN",
    );
    expect(publicErrorMessage("VALIDATION")).not.toMatch(
      /employment_terms|hourly_wage|work_records/i,
    );
  });

  it("does not surface DB internals in public messages", () => {
    expect(publicErrorMessage("INTERNAL")).toMatch(/失敗しました/);
    expect(publicErrorMessage("INTERNAL")).not.toMatch(/supabase|postgres|column/i);
  });
});
