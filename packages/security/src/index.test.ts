import { describe, expect, it } from "vitest";
import { hasPermission, isSafeStoragePath } from "./index.js";

describe("hasPermission", () => {
  it("grants member task:create", () => {
    expect(hasPermission({ roles: ["member"] }, "task:create")).toBe(true);
  });

  it("denies member organization:manage", () => {
    expect(hasPermission({ roles: ["member"] }, "organization:manage")).toBe(
      false,
    );
  });

  it("grants admin all permissions", () => {
    expect(hasPermission({ roles: ["admin"] }, "system:diagnose")).toBe(true);
  });

  it("respects extra permissions", () => {
    expect(
      hasPermission(
        { roles: ["member"], extraPermissions: ["audit:read"] },
        "audit:read",
      ),
    ).toBe(true);
  });
});

describe("storage path traversal", () => {
  it("rejects parent traversal", () => {
    expect(isSafeStoragePath("../secrets")).toBe(false);
  });

  it("accepts normal paths", () => {
    expect(isSafeStoragePath("org/abc/knowledge/doc.pdf")).toBe(true);
  });
});
