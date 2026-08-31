import { describe, expect, it } from "vitest";
import { departmentScope, projectScope, selfScope } from "@regapro/shared";
import {
  hasPermission,
  evaluatePermission,
  listPlatformPermissions,
  mergeGrants,
  scopeCovers,
} from "./rbac.js";
import {
  DEPT_PEOPLE,
  DEPT_SALES,
  PROJECT_ALPHA,
  deny,
  grant,
  makeAccess,
} from "./test-support.js";

describe("permission grant and deny", () => {
  it("allows a granted permission", () => {
    const ctx = makeAccess({ grants: [grant("weekly_pay.submit")] });
    expect(hasPermission(ctx, "weekly_pay.submit")).toBe(true);
  });

  it("denies a permission that was never granted", () => {
    const ctx = makeAccess({ grants: [grant("weekly_pay.submit")] });
    expect(hasPermission(ctx, "expense.manage")).toBe(false);
    expect(evaluatePermission(ctx, { permission: "expense.manage" }).reason).toBe(
      "no_grant",
    );
  });

  it("lets a deny override beat a role grant", () => {
    const ctx = makeAccess({
      grants: [grant("expense.manage"), deny("expense.manage")],
    });
    expect(hasPermission(ctx, "expense.manage")).toBe(false);
    expect(
      evaluatePermission(ctx, { permission: "expense.manage" }).reason,
    ).toBe("denied_by_override");
  });

  it("keeps denied permissions out of the effective list", () => {
    const ctx = makeAccess({
      grants: [grant("sales.view_own"), grant("expense.manage"), deny("expense.manage")],
    });
    expect(listPlatformPermissions(ctx)).toEqual(["sales.view_own"]);
  });
});

describe("role permission composition", () => {
  it("unions permissions across several assigned roles", () => {
    const ctx = makeAccess({
      grants: [
        { ...grant("ai.use"), roleId: "role-base" },
        { ...grant("weekly_pay.submit"), roleId: "role-weekly" },
        { ...grant("mypage.use"), roleId: "role-base" },
      ],
    });
    expect(listPlatformPermissions(ctx).sort()).toEqual([
      "ai.use",
      "mypage.use",
      "weekly_pay.submit",
    ]);
  });

  it("replaces a role grant with a same-scope override", () => {
    const merged = mergeGrants([grant("sales.manage")], [deny("sales.manage")]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.effect).toBe("deny");
  });
});

describe("scoped permission", () => {
  it("treats an organization grant as covering every scope", () => {
    expect(scopeCovers({ type: "organization", id: null }, departmentScope(DEPT_SALES))).toBe(true);
    expect(scopeCovers({ type: "organization", id: null }, selfScope("staff-1"))).toBe(true);
  });

  it("limits a department grant to that department", () => {
    const ctx = makeAccess({
      grants: [grant("expense.manage", departmentScope(DEPT_SALES))],
    });
    expect(hasPermission(ctx, "expense.manage", departmentScope(DEPT_SALES))).toBe(true);
    expect(hasPermission(ctx, "expense.manage", departmentScope(DEPT_PEOPLE))).toBe(false);
    expect(
      evaluatePermission(ctx, {
        permission: "expense.manage",
        scope: departmentScope(DEPT_PEOPLE),
      }).reason,
    ).toBe("out_of_scope");
  });

  it("does not let a department grant satisfy a project ask", () => {
    const ctx = makeAccess({
      grants: [grant("sales.manage", departmentScope(DEPT_SALES))],
    });
    expect(hasPermission(ctx, "sales.manage", projectScope(PROJECT_ALPHA))).toBe(false);
  });

  it("restricts a self grant to the caller's own records", () => {
    const ctx = makeAccess({
      staffId: "staff-1",
      grants: [grant("weekly_pay.submit", selfScope("staff-1"))],
    });
    expect(hasPermission(ctx, "weekly_pay.submit", selfScope("staff-1"))).toBe(true);
    expect(hasPermission(ctx, "weekly_pay.submit", selfScope("staff-2"))).toBe(false);
    expect(
      hasPermission(ctx, "weekly_pay.submit", departmentScope(DEPT_SALES)),
    ).toBe(false);
  });

  it("denies at a narrower scope when the deny covers it", () => {
    const ctx = makeAccess({
      grants: [grant("expense.manage"), deny("expense.manage", departmentScope(DEPT_PEOPLE))],
    });
    expect(hasPermission(ctx, "expense.manage", departmentScope(DEPT_SALES))).toBe(true);
    expect(hasPermission(ctx, "expense.manage", departmentScope(DEPT_PEOPLE))).toBe(false);
  });
});

describe("inactive staff", () => {
  it("refuses every permission for suspended staff", () => {
    const ctx = makeAccess({
      staffStatus: "suspended",
      grants: [grant("expense.manage"), grant("ai.use")],
    });
    expect(hasPermission(ctx, "expense.manage")).toBe(false);
    expect(hasPermission(ctx, "ai.use")).toBe(false);
    expect(evaluatePermission(ctx, { permission: "ai.use" }).reason).toBe(
      "staff_inactive",
    );
  });

  it("refuses every permission for staff who have left", () => {
    const ctx = makeAccess({
      staffStatus: "left",
      grants: [grant("weekly_pay.submit")],
    });
    expect(hasPermission(ctx, "weekly_pay.submit")).toBe(false);
  });
});

describe("employment type is not a permission input", () => {
  it("gives identical decisions for identical grants across employment types", () => {
    const grants = [grant("weekly_pay.submit"), grant("ai.use")];
    const partTime = makeAccess({ employmentType: "part_time", grants });
    const employee = makeAccess({ employmentType: "employee", grants });
    const executive = makeAccess({ employmentType: "executive", grants });

    for (const ctx of [partTime, employee, executive]) {
      expect(hasPermission(ctx, "weekly_pay.submit")).toBe(true);
      expect(hasPermission(ctx, "expense.manage")).toBe(false);
      expect(hasPermission(ctx, "sales.manage")).toBe(false);
    }
  });

  it("does not grant management to an executive without the permission", () => {
    const executive = makeAccess({ employmentType: "executive", grants: [] });
    expect(hasPermission(executive, "admin.access")).toBe(false);
    expect(hasPermission(executive, "expense.manage")).toBe(false);
  });

  it("grants management to a part-timer who holds the permission", () => {
    const partTime = makeAccess({
      employmentType: "part_time",
      grants: [grant("expense.manage")],
    });
    expect(hasPermission(partTime, "expense.manage")).toBe(true);
  });
});
