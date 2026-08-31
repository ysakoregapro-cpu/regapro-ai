import { describe, expect, it } from "vitest";
import { selfScope } from "@regapro/shared";
import {
  PlatformAccessError,
  isPlatformAccessError,
  requireAllPermissions,
  requireModuleAccess,
  requirePermission,
} from "./guards.js";
import { canViewModule } from "./navigation.js";
import { getModule } from "./modules.js";
import { grant, makeAccess } from "./test-support.js";

function denialCode(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (isPlatformAccessError(err)) return err.code;
    throw err;
  }
  return "ALLOWED";
}

describe("route guard denies direct URL access", () => {
  it("refuses a module the caller cannot see in navigation", () => {
    const ctx = makeAccess({ grants: [grant("ai.use"), grant("mypage.use")] });
    expect(canViewModule(ctx, getModule("admin"))).toBe(false);
    expect(denialCode(() => requireModuleAccess(ctx, "admin"))).toBe("FORBIDDEN");
  });

  it("uses the same predicate as navigation, so visible implies reachable", () => {
    const ctx = makeAccess({ grants: [grant("admin.access")] });
    expect(canViewModule(ctx, getModule("admin"))).toBe(true);
    expect(() => requireModuleAccess(ctx, "admin")).not.toThrow();
  });

  it("refuses a planned module even to a caller holding its permission", () => {
    const ctx = makeAccess({ grants: [grant("expense.manage")] });
    expect(denialCode(() => requireModuleAccess(ctx, "expense"))).toBe(
      "MODULE_UNAVAILABLE",
    );
    expect(denialCode(() => requireModuleAccess(ctx, "weekly_pay"))).toBe(
      "MODULE_UNAVAILABLE",
    );
  });

  it("refuses everything to suspended staff", () => {
    const ctx = makeAccess({
      staffStatus: "suspended",
      grants: [grant("admin.access")],
    });
    expect(denialCode(() => requireModuleAccess(ctx, "admin"))).toBe(
      "STAFF_INACTIVE",
    );
  });
});

describe("permission guard", () => {
  it("passes for a held permission", () => {
    const ctx = makeAccess({ grants: [grant("weekly_pay.submit")] });
    expect(() => requirePermission(ctx, "weekly_pay.submit")).not.toThrow();
  });

  it("throws a typed error carrying the permission", () => {
    const ctx = makeAccess({ grants: [] });
    try {
      requirePermission(ctx, "expense.manage");
      throw new Error("expected refusal");
    } catch (err) {
      expect(err).toBeInstanceOf(PlatformAccessError);
      expect((err as PlatformAccessError).permission).toBe("expense.manage");
      expect((err as PlatformAccessError).code).toBe("FORBIDDEN");
    }
  });

  it("enforces scope on a self-scoped grant", () => {
    const ctx = makeAccess({
      staffId: "staff-1",
      grants: [grant("weekly_pay.submit", selfScope("staff-1"))],
    });
    expect(() =>
      requirePermission(ctx, "weekly_pay.submit", selfScope("staff-1")),
    ).not.toThrow();
    expect(
      denialCode(() =>
        requirePermission(ctx, "weekly_pay.submit", selfScope("staff-2")),
      ),
    ).toBe("FORBIDDEN");
  });

  it("requires every permission with requireAllPermissions", () => {
    const ctx = makeAccess({ grants: [grant("admin.access")] });
    expect(
      denialCode(() =>
        requireAllPermissions(ctx, ["admin.access", "admin.role_manage"]),
      ),
    ).toBe("FORBIDDEN");
  });

  it("never leaks the permission key in the user-facing message", () => {
    const ctx = makeAccess({ grants: [] });
    try {
      requirePermission(ctx, "admin.role_manage");
    } catch (err) {
      expect((err as Error).message).not.toContain("admin.role_manage");
    }
  });
});
