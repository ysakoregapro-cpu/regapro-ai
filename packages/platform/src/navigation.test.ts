import { describe, expect, it } from "vitest";
import {
  buildDashboardShortcuts,
  buildMobileNavigation,
  buildNavigation,
  canViewModule,
  visibleModules,
} from "./navigation.js";
import { getModule, findModuleByPath } from "./modules.js";
import { grant, makeAccess } from "./test-support.js";

const labels = (items: { label: string }[]) => items.map((i) => i.label);

describe("permission-driven navigation", () => {
  it("shows a part-timer only AI, weekly pay, and My Page", () => {
    const ctx = makeAccess({
      employmentType: "part_time",
      grants: [grant("ai.use"), grant("weekly_pay.submit"), grant("mypage.use")],
    });
    const nav = buildNavigation(ctx);

    expect(labels(nav.primary)).toContain("アシスタント");
    expect(labels(nav.personal)).toContain("マイページ");

    // Expense / Sales management and Admin must not appear.
    const all = [...nav.primary, ...nav.work, ...nav.personal, ...nav.advanced];
    expect(labels(all)).not.toContain("経費");
    expect(labels(all)).not.toContain("売上");
    expect(labels(all)).not.toContain("管理センター");
  });

  it("hides Sales from an employee without sales.view_own", () => {
    const ctx = makeAccess({
      employmentType: "employee",
      grants: [grant("ai.use"), grant("tasks.use"), grant("mypage.use")],
    });
    expect(canViewModule(ctx, getModule("sales"))).toBe(false);
    expect(labels(buildNavigation(ctx).work)).not.toContain("売上");
  });

  it("hides Admin from a staff member without admin.access", () => {
    const ctx = makeAccess({ grants: [grant("ai.use"), grant("mypage.use")] });
    expect(canViewModule(ctx, getModule("admin"))).toBe(false);
    expect(labels(buildNavigation(ctx).advanced)).not.toContain("管理センター");
  });

  it("shows Admin once admin.access is granted", () => {
    const ctx = makeAccess({ grants: [grant("admin.access")] });
    expect(canViewModule(ctx, getModule("admin"))).toBe(true);
    expect(labels(buildNavigation(ctx).advanced)).toContain("管理センター");
  });

  it("never shows a planned module, even with its permission", () => {
    const ctx = makeAccess({
      grants: [grant("expense.manage"), grant("sales.manage"), grant("chat.use")],
    });
    const all = visibleModules(ctx, "desktop");
    expect(all.map((m) => m.id)).not.toContain("expense");
    expect(all.map((m) => m.id)).not.toContain("sales");
    expect(all.map((m) => m.id)).not.toContain("chat");
  });

  it("does not consult employment type", () => {
    const grants = [grant("ai.use"), grant("tasks.use"), grant("mypage.use")];
    const asPartTime = buildNavigation(makeAccess({ employmentType: "part_time", grants }));
    const asExecutive = buildNavigation(makeAccess({ employmentType: "executive", grants }));
    expect(labels(asPartTime.primary)).toEqual(labels(asExecutive.primary));
    expect(labels(asPartTime.advanced)).toEqual(labels(asExecutive.advanced));
  });

  it("hides everything but Home for staff with no grants", () => {
    const ctx = makeAccess({ grants: [] });
    expect(labels(buildNavigation(ctx).primary)).toEqual(["ホーム"]);
  });

  it("refuses navigation to suspended staff beyond Home", () => {
    const ctx = makeAccess({
      staffStatus: "suspended",
      grants: [grant("ai.use"), grant("admin.access")],
    });
    const nav = buildNavigation(ctx);
    expect(labels(nav.primary)).toEqual(["ホーム"]);
    expect(nav.advanced).toEqual([]);
  });
});

describe("surface filtering", () => {
  it("limits mobile navigation to mobile-visible modules", () => {
    const ctx = makeAccess({
      grants: [grant("ai.use"), grant("tasks.use"), grant("mypage.use"), grant("admin.access")],
    });
    const mobile = buildMobileNavigation(ctx);
    expect(labels(mobile)).not.toContain("ワークスペース");
    expect(labels(mobile)).not.toContain("管理センター");
    expect(labels(mobile)).toContain("ホーム");
  });

  it("limits dashboard shortcuts to dashboard-visible modules", () => {
    const ctx = makeAccess({ grants: [grant("ai.use"), grant("tasks.use")] });
    expect(labels(buildDashboardShortcuts(ctx))).not.toContain("ホーム");
    expect(labels(buildDashboardShortcuts(ctx))).toContain("アシスタント");
  });
});

describe("route ownership", () => {
  it("resolves a path to its owning module by longest prefix", () => {
    expect(findModuleByPath("/workspace/knowledge")?.id).toBe("workspace");
    expect(findModuleByPath("/work/expense/new")?.id).toBe("expense");
    expect(findModuleByPath("/admin/roles")?.id).toBe("admin");
    expect(findModuleByPath("/login")).toBeNull();
  });

  it("does not match a sibling route by string prefix", () => {
    expect(findModuleByPath("/homepage")).toBeNull();
  });
});
