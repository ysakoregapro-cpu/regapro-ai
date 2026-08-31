import { describe, expect, it } from "vitest";
import { PlatformAccessError } from "@regapro/platform";
import { publicErrorMessage } from "@/lib/application/api-errors";
import { platformErrorToAppCode } from "./error-mapping";

describe("API guard denial mapping", () => {
  it("maps a permission refusal to FORBIDDEN", () => {
    const err = new PlatformAccessError({
      code: "FORBIDDEN",
      message: "no",
      permission: "expense.manage",
    });
    expect(platformErrorToAppCode(err)).toBe("FORBIDDEN");
  });

  it("maps an inactive staff refusal to FORBIDDEN", () => {
    const err = new PlatformAccessError({ code: "STAFF_INACTIVE", message: "no" });
    expect(platformErrorToAppCode(err)).toBe("FORBIDDEN");
  });

  it("hides an unshipped module behind NOT_FOUND", () => {
    const err = new PlatformAccessError({
      code: "MODULE_UNAVAILABLE",
      message: "no",
      moduleId: "expense",
    });
    expect(platformErrorToAppCode(err)).toBe("NOT_FOUND");
  });

  it("leaves unrelated errors to the existing classifier", () => {
    expect(platformErrorToAppCode(new Error("boom"))).toBeNull();
  });

  it("returns a message that names no permission or module", () => {
    const message = publicErrorMessage("FORBIDDEN");
    expect(message).not.toMatch(/expense|permission|staff_role/i);
    expect(message).toContain("権限");
  });
});
