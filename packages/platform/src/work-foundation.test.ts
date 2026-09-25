import { describe, expect, it } from "vitest";
import { isPlatformPermission } from "@regapro/shared";
import { hasPermission } from "./rbac.js";
import {
  canViewModule,
  visibleModules,
  buildNavigation,
  buildDashboardShortcuts,
  buildMobileNavigation,
} from "./navigation.js";
import { getModule, findModuleByPath } from "./modules.js";
import {
  PLATFORM_ROLE_TEMPLATES,
  permissionsForRoleTemplate,
} from "./role-templates.js";
import { deny, grant, makeAccess } from "./test-support.js";

function grantsFrom(role: keyof typeof PLATFORM_ROLE_TEMPLATES) {
  return permissionsForRoleTemplate(role).map((permission) => grant(permission));
}

describe("weekly pay permission contract", () => {
  it("keeps existing weekly_pay.submit valid", () => {
    expect(isPlatformPermission("weekly_pay.submit")).toBe(true);
    const ctx = makeAccess({ grants: [grant("weekly_pay.submit")] });
    expect(hasPermission(ctx, "weekly_pay.submit")).toBe(true);
  });

  it("keeps existing weekly_pay.manage valid", () => {
    expect(isPlatformPermission("weekly_pay.manage")).toBe(true);
    const ctx = makeAccess({ grants: [grant("weekly_pay.manage")] });
    expect(hasPermission(ctx, "weekly_pay.manage")).toBe(true);
  });

  it("defines review, pay, and policy_manage as distinct keys", () => {
    expect(isPlatformPermission("weekly_pay.review")).toBe(true);
    expect(isPlatformPermission("weekly_pay.pay")).toBe(true);
    expect(isPlatformPermission("weekly_pay.policy_manage")).toBe(true);
  });

  it("does not give a submitter review", () => {
    const ctx = makeAccess({ grants: grantsFrom("platform_weekly_pay_submitter") });
    expect(hasPermission(ctx, "weekly_pay.submit")).toBe(true);
    expect(hasPermission(ctx, "weekly_pay.review")).toBe(false);
    expect(hasPermission(ctx, "weekly_pay.pay")).toBe(false);
  });

  it("does not give a reviewer pay", () => {
    const ctx = makeAccess({ grants: grantsFrom("platform_weekly_pay_reviewer") });
    expect(hasPermission(ctx, "weekly_pay.review")).toBe(true);
    expect(hasPermission(ctx, "weekly_pay.pay")).toBe(false);
    expect(hasPermission(ctx, "weekly_pay.submit")).toBe(false);
  });

  it("does not give a payer review", () => {
    const ctx = makeAccess({ grants: grantsFrom("platform_weekly_pay_payer") });
    expect(hasPermission(ctx, "weekly_pay.pay")).toBe(true);
    expect(hasPermission(ctx, "weekly_pay.review")).toBe(false);
    expect(hasPermission(ctx, "weekly_pay.manage")).toBe(false);
  });

  it("does not let manage imply pay or review", () => {
    const ctx = makeAccess({ grants: grantsFrom("platform_weekly_pay_manager") });
    expect(hasPermission(ctx, "weekly_pay.manage")).toBe(true);
    expect(hasPermission(ctx, "weekly_pay.submit")).toBe(true);
    expect(hasPermission(ctx, "weekly_pay.review")).toBe(false);
    expect(hasPermission(ctx, "weekly_pay.pay")).toBe(false);
    expect(hasPermission(ctx, "weekly_pay.policy_manage")).toBe(false);
  });
});

describe("shift permission contract", () => {
  it("gives a shift user view_own and request only", () => {
    const ctx = makeAccess({ grants: grantsFrom("platform_shift_user") });
    expect(hasPermission(ctx, "shift.view_own")).toBe(true);
    expect(hasPermission(ctx, "shift.request")).toBe(true);
    expect(hasPermission(ctx, "shift.manage")).toBe(false);
  });

  it("gives a shift manager manage", () => {
    const ctx = makeAccess({ grants: grantsFrom("platform_shift_manager") });
    expect(hasPermission(ctx, "shift.manage")).toBe(true);
    expect(hasPermission(ctx, "shift.view_own")).toBe(false);
    expect(hasPermission(ctx, "shift.request")).toBe(false);
  });
});

describe("documents permission seed", () => {
  it("registers use and manage without implying each other", () => {
    expect(isPlatformPermission("documents.use")).toBe(true);
    expect(isPlatformPermission("documents.manage")).toBe(true);
    const user = makeAccess({ grants: [grant("documents.use")] });
    expect(hasPermission(user, "documents.use")).toBe(true);
    expect(hasPermission(user, "documents.manage")).toBe(false);
  });
});

describe("employment type is not a grant source", () => {
  it("does not add weekly_pay or shift permissions when employment type changes", () => {
    const empty = { grants: [] as ReturnType<typeof grant>[] };
    for (const employmentType of ["part_time", "employee", "executive"] as const) {
      const ctx = makeAccess({ ...empty, employmentType });
      expect(hasPermission(ctx, "weekly_pay.submit")).toBe(false);
      expect(hasPermission(ctx, "weekly_pay.review")).toBe(false);
      expect(hasPermission(ctx, "weekly_pay.pay")).toBe(false);
      expect(hasPermission(ctx, "shift.manage")).toBe(false);
    }
  });
});

describe("deny override and missing grants", () => {
  it("lets a deny override beat a role grant", () => {
    const ctx = makeAccess({
      grants: [grant("weekly_pay.review"), deny("weekly_pay.review")],
    });
    expect(hasPermission(ctx, "weekly_pay.review")).toBe(false);
  });

  it("does not invent a grant that was never loaded (expired path)", () => {
    const ctx = makeAccess({ grants: [grant("weekly_pay.submit")] });
    expect(hasPermission(ctx, "weekly_pay.review")).toBe(false);
    expect(hasPermission(ctx, "weekly_pay.pay")).toBe(false);
  });
});

describe("platform_admin template", () => {
  it("receives the new platform permissions without collapsing review and pay", () => {
    const keys = permissionsForRoleTemplate("platform_admin");
    expect(keys).toEqual(
      expect.arrayContaining([
        "admin.access",
        "admin.role_manage",
        "weekly_pay.review",
        "weekly_pay.pay",
        "weekly_pay.manage",
        "weekly_pay.policy_manage",
        "shift.view_own",
        "shift.request",
        "shift.manage",
        "documents.use",
        "documents.manage",
      ]),
    );
    const ctx = makeAccess({ grants: grantsFrom("platform_admin") });
    expect(hasPermission(ctx, "weekly_pay.review")).toBe(true);
    expect(hasPermission(ctx, "weekly_pay.pay")).toBe(true);
    expect(hasPermission(ctx, "shift.manage")).toBe(true);
  });
});

describe("planned work modules stay hidden", () => {
  it("hides weekly_pay, shift, documents, and work even with permissions", () => {
    const ctx = makeAccess({
      grants: [
        grant("weekly_pay.submit"),
        grant("weekly_pay.review"),
        grant("weekly_pay.pay"),
        grant("weekly_pay.manage"),
        grant("weekly_pay.policy_manage"),
        grant("shift.view_own"),
        grant("shift.request"),
        grant("shift.manage"),
        grant("documents.use"),
        grant("documents.manage"),
      ],
    });

    expect(getModule("weekly_pay").featureState).toBe("planned");
    expect(getModule("shift").featureState).toBe("planned");
    expect(getModule("documents").featureState).toBe("planned");
    expect(getModule("work").featureState).toBe("planned");

    expect(canViewModule(ctx, getModule("weekly_pay"))).toBe(false);
    expect(canViewModule(ctx, getModule("shift"))).toBe(false);
    expect(canViewModule(ctx, getModule("documents"))).toBe(false);
    expect(canViewModule(ctx, getModule("work"))).toBe(false);

    const ids = visibleModules(ctx, "desktop").map((m) => m.id);
    expect(ids).not.toContain("weekly_pay");
    expect(ids).not.toContain("shift");
    expect(ids).not.toContain("documents");
    expect(ids).not.toContain("work");

    const labels = (items: { label: string }[]) => items.map((i) => i.label);
    const nav = buildNavigation(ctx);
    expect(labels(nav.work)).not.toContain("週払い");
    expect(labels(nav.work)).not.toContain("シフト");
    expect(labels(nav.work)).not.toContain("書類");
    expect(labels(buildDashboardShortcuts(ctx))).not.toContain("週払い");
    expect(labels(buildMobileNavigation(ctx))).not.toContain("シフト");
  });

  it("uses any-of permissions for weekly_pay when it later becomes available", () => {
    const module = getModule("weekly_pay");
    expect(module.permissionMode).toBe("any");
    expect(module.requiredPermissions).toEqual(
      expect.arrayContaining([
        "weekly_pay.submit",
        "weekly_pay.review",
        "weekly_pay.pay",
        "weekly_pay.manage",
        "weekly_pay.policy_manage",
      ]),
    );
  });
});

describe("existing nav and route regression", () => {
  it("still shows shipped surfaces and keeps work routes owned by planned modules", () => {
    const ctx = makeAccess({
      grants: [grant("ai.use"), grant("tasks.use"), grant("mypage.use"), grant("admin.access")],
    });
    const nav = buildNavigation(ctx);
    const labels = (items: { label: string }[]) => items.map((i) => i.label);
    expect(labels(nav.primary)).toEqual(
      expect.arrayContaining(["ホーム", "アシスタント", "タスク"]),
    );
    expect(labels(nav.advanced)).toContain("管理センター");
    expect(findModuleByPath("/admin/roles")?.id).toBe("admin");
    expect(findModuleByPath("/work/weekly-pay")?.id).toBe("weekly_pay");
    expect(findModuleByPath("/work/shift")?.id).toBe("shift");
    expect(findModuleByPath("/workspace/documents")?.id).toBe("workspace");
  });
});
