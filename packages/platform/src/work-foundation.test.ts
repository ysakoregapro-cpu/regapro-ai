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
    expect(hasPermission(ctx, "work_record.view_own")).toBe(true);
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

describe("work record / employment terms permission contract", () => {
  it("gives a work record user view_own and submit only", () => {
    const ctx = makeAccess({ grants: grantsFrom("platform_work_record_user") });
    expect(hasPermission(ctx, "work_record.view_own")).toBe(true);
    expect(hasPermission(ctx, "work_record.submit")).toBe(true);
    expect(hasPermission(ctx, "work_record.manage")).toBe(false);
    expect(hasPermission(ctx, "employment_terms.manage")).toBe(false);
  });

  it("gives a work record manager manage without submit", () => {
    const ctx = makeAccess({ grants: grantsFrom("platform_work_record_manager") });
    expect(hasPermission(ctx, "work_record.manage")).toBe(true);
    expect(hasPermission(ctx, "work_record.view_own")).toBe(false);
    expect(hasPermission(ctx, "work_record.submit")).toBe(false);
  });

  it("gives an employment terms manager only that key", () => {
    const ctx = makeAccess({ grants: grantsFrom("platform_employment_terms_manager") });
    expect(hasPermission(ctx, "employment_terms.manage")).toBe(true);
    expect(hasPermission(ctx, "work_record.manage")).toBe(false);
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
      expect(hasPermission(ctx, "work_record.submit")).toBe(false);
      expect(hasPermission(ctx, "work_record.manage")).toBe(false);
      expect(hasPermission(ctx, "employment_terms.manage")).toBe(false);
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
        "work_record.view_own",
        "work_record.submit",
        "work_record.manage",
        "employment_terms.manage",
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

describe("Phase 7 work modules visibility", () => {
  it("exposes weekly_pay, shift, work_record; keeps expense/sales/documents/work planned", () => {
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
        grant("work_record.view_own"),
        grant("work_record.submit"),
        grant("work_record.manage"),
        grant("employment_terms.manage"),
        grant("documents.use"),
        grant("documents.manage"),
        grant("expense.submit"),
        grant("sales.view_own"),
      ],
    });

    expect(getModule("weekly_pay").featureState).toBe("available");
    expect(getModule("shift").featureState).toBe("available");
    expect(getModule("work_record").featureState).toBe("available");
    expect(getModule("documents").featureState).toBe("planned");
    expect(getModule("expense").featureState).toBe("planned");
    expect(getModule("sales").featureState).toBe("planned");
    expect(getModule("work").featureState).toBe("planned");

    expect(canViewModule(ctx, getModule("weekly_pay"))).toBe(true);
    expect(canViewModule(ctx, getModule("shift"))).toBe(true);
    expect(canViewModule(ctx, getModule("work_record"))).toBe(true);
    expect(canViewModule(ctx, getModule("documents"))).toBe(false);
    expect(canViewModule(ctx, getModule("expense"))).toBe(false);
    expect(canViewModule(ctx, getModule("sales"))).toBe(false);
    expect(canViewModule(ctx, getModule("work"))).toBe(false);

    const ids = visibleModules(ctx, "desktop").map((m) => m.id);
    expect(ids).toContain("weekly_pay");
    expect(ids).toContain("shift");
    expect(ids).toContain("work_record");
    expect(ids).not.toContain("documents");
    expect(ids).not.toContain("expense");
    expect(ids).not.toContain("sales");
    expect(ids).not.toContain("work");

    const labels = (items: { label: string }[]) => items.map((i) => i.label);
    const nav = buildNavigation(ctx);
    expect(labels(nav.work)).toEqual(
      expect.arrayContaining(["週払い", "シフト", "勤務実績"]),
    );
    expect(labels(nav.work)).not.toContain("経費");
    expect(labels(nav.work)).not.toContain("売上");
    expect(labels(nav.work)).not.toContain("書類");
    expect(labels(buildDashboardShortcuts(ctx))).toEqual(
      expect.arrayContaining(["週払い", "シフト", "勤務実績"]),
    );
    expect(labels(buildMobileNavigation(ctx))).toEqual(
      expect.arrayContaining(["シフト", "勤務実績"]),
    );
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
    expect(findModuleByPath("/work/records")?.id).toBe("work_record");
    expect(findModuleByPath("/workspace/documents")?.id).toBe("workspace");
  });
});
