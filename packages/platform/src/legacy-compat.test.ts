import { describe, expect, it } from "vitest";
import { buildAccessContext } from "@regapro/security";
import {
  derivePlatformGrantsFromLegacy,
  effectiveGrants,
  withLegacyCompatibilityGrants,
} from "./legacy-compat.js";
import { hasPermission, listPlatformPermissions } from "./rbac.js";
import { buildNavigation, canViewModule } from "./navigation.js";
import { getModule } from "./modules.js";
import { grant, makeAccess } from "./test-support.js";

/** An AI user from before the staff backfill: no staff record at all. */
function legacyOnlyAccess(permissionKeys: Parameters<typeof buildAccessContext>[0]["extraPermissions"]) {
  return buildAccessContext({
    userId: "auth-user-legacy",
    organizationId: "11111111-1111-1111-1111-111111111111",
    membershipId: "membership-legacy",
    departmentId: "33333333-3333-3333-3333-333333333333",
    departmentKey: "sales",
    roles: [],
    extraPermissions: permissionKeys,
  });
}

describe("existing AI users keep working before staff backfill", () => {
  it("reports compatibility mode when no staff record is linked", () => {
    const ctx = legacyOnlyAccess(["chat:use"]);
    expect(ctx.staffId).toBeNull();
    expect(withLegacyCompatibilityGrants(ctx).permissions).not.toHaveLength(0);
  });

  it("bridges chat:use to ai.use so the assistant stays reachable", () => {
    const ctx = withLegacyCompatibilityGrants(legacyOnlyAccess(["chat:use"]));
    expect(hasPermission(ctx, "ai.use")).toBe(true);
    expect(canViewModule(ctx, getModule("ai"))).toBe(true);
  });

  it("gives every authenticated user their own page", () => {
    const ctx = withLegacyCompatibilityGrants(legacyOnlyAccess([]));
    expect(hasPermission(ctx, "mypage.use")).toBe(true);
  });

  it("keeps the shipped surfaces visible during compatibility mode", () => {
    const nav = buildNavigation(legacyOnlyAccess(["chat:use", "task:read"]));
    const labels = nav.primary.map((i) => i.label);
    expect(labels).toContain("ホーム");
    expect(labels).toContain("アシスタント");
    expect(labels).toContain("タスク");
    expect(labels).toContain("検索");
    expect(labels).toContain("ワークスペース");
  });

  it("never bridges a legacy key into a business-module permission", () => {
    const ctx = withLegacyCompatibilityGrants(
      legacyOnlyAccess([
        "chat:use",
        "knowledge:read",
        "knowledge:write",
        "research:run",
        "conversation:audit",
        "clearance:manage",
      ]),
    );
    for (const permission of [
      "expense.submit",
      "expense.manage",
      "sales.view_own",
      "sales.manage",
      "weekly_pay.submit",
      "weekly_pay.manage",
    ] as const) {
      expect(hasPermission(ctx, permission)).toBe(false);
    }
  });

  it("maps organization:manage onto the admin permissions", () => {
    const ctx = withLegacyCompatibilityGrants(
      legacyOnlyAccess(["organization:manage"]),
    );
    expect(listPlatformPermissions(ctx).sort()).toContain("admin.role_manage");
    expect(hasPermission(ctx, "admin.access")).toBe(true);
  });

  it("stops deriving from legacy keys once real staff grants exist", () => {
    const ctx = makeAccess({
      legacyPermissions: ["organization:manage"],
      grants: [grant("ai.use")],
    });
    expect(effectiveGrants(ctx).map((g) => g.permission)).toEqual(["ai.use"]);
    expect(hasPermission(ctx, "admin.access")).toBe(false);
  });

  it("marks derived grants so their origin stays visible", () => {
    const grants = derivePlatformGrantsFromLegacy({ permissionKeys: ["chat:use"] });
    expect(grants.every((g) => g.source === "legacy_compat")).toBe(true);
  });
});

describe("Feature Permission and Knowledge Clearance are independent axes", () => {
  it("does not grant business permissions from executive clearance", () => {
    const executiveClearance = buildAccessContext({
      userId: "auth-user-exec",
      organizationId: "11111111-1111-1111-1111-111111111111",
      membershipId: "membership-exec",
      departmentId: "44444444-4444-4444-4444-444444444444",
      departmentKey: "executive_strategy",
      roles: ["admin"],
      staff: {
        staffId: "staff-exec",
        staffNo: "S-0002",
        name: "役員",
        employmentType: "executive",
        status: "active",
      },
      permissions: [],
    });

    expect(executiveClearance.maximumConfidentialityLevel).toBe("executive");
    expect(hasPermission(executiveClearance, "expense.manage")).toBe(false);
    expect(hasPermission(executiveClearance, "sales.manage")).toBe(false);
    expect(hasPermission(executiveClearance, "admin.access")).toBe(false);
  });

  it("does not raise clearance when a business permission is granted", () => {
    const ctx = makeAccess({
      grants: [grant("expense.manage"), grant("sales.manage"), grant("admin.access")],
    });
    expect(ctx.maximumConfidentialityLevel).toBe("company");
    expect(hasPermission(ctx, "expense.manage")).toBe(true);
  });

  it("keeps the legacy AI permission list untouched by platform grants", () => {
    const ctx = makeAccess({
      legacyPermissions: ["chat:use", "knowledge:read"],
      grants: [grant("expense.manage")],
    });
    expect(ctx.permissionKeys).toContain("chat:use");
    expect(ctx.permissionKeys).not.toContain("expense.manage" as never);
    expect(listPlatformPermissions(ctx)).toEqual(["expense.manage"]);
  });
});
