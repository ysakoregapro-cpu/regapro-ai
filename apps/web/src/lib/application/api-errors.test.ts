import { describe, expect, it } from "vitest";
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

  it("does not surface DB internals in public messages", () => {
    expect(publicErrorMessage("INTERNAL")).toMatch(/失敗しました/);
    expect(publicErrorMessage("INTERNAL")).not.toMatch(/supabase|postgres|column/i);
  });
});
