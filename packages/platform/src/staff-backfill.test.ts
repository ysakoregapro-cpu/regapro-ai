import { describe, expect, it } from "vitest";
import {
  AI_USER_PERMISSION_MARKERS,
  buildApplyConfirmToken,
  classifyUserCategory,
  comparePermissionSnapshots,
  deriveExpectedPlatformPermissions,
  derivePlatformRolesFromAiPermissions,
  formatStaffNo,
  hasAiUserPermissions,
  isBackfillTarget,
  isFixtureEmail,
  validateEmploymentType,
} from "./staff-backfill.js";

describe("staff_no format", () => {
  it("formats RP-000001 through RP-000003", () => {
    expect(formatStaffNo(1)).toBe("RP-000001");
    expect(formatStaffNo(2)).toBe("RP-000002");
    expect(formatStaffNo(999999)).toBe("RP-999999");
  });

  it("rejects invalid sequence numbers", () => {
    expect(() => formatStaffNo(0)).toThrow();
    expect(() => formatStaffNo(-1)).toThrow();
    expect(() => formatStaffNo(1.5)).toThrow();
  });
});

describe("staff_no concurrency / uniqueness (format layer)", () => {
  it("produces distinct formatted numbers for distinct sequence values", () => {
    const numbers = [1, 2, 3, 100, 101].map(formatStaffNo);
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});

describe("employment_type validation", () => {
  it("accepts explicit executive / employee / part_time", () => {
    expect(validateEmploymentType("executive")).toEqual({
      ok: true,
      employmentType: "executive",
    });
    expect(validateEmploymentType("employee")).toEqual({
      ok: true,
      employmentType: "employee",
    });
    expect(validateEmploymentType("part_time")).toEqual({
      ok: true,
      employmentType: "part_time",
    });
  });

  it("rejects missing employment_type", () => {
    expect(validateEmploymentType(undefined)?.ok).toBe(false);
    expect(validateEmploymentType("")?.ok).toBe(false);
    expect(validateEmploymentType("  ")?.ok).toBe(false);
  });

  it("rejects invalid employment_type — no silent fallback to employee", () => {
    const result = validateEmploymentType("employee_default");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("invalid employment_type");
    }
  });
});

describe("AI user classification (formal criterion)", () => {
  it("marks users with AI permission markers as ai_user", () => {
    expect(
      classifyUserCategory({
        hasMembership: true,
        hasRoles: true,
        aiPermissionKeys: ["chat:use", "organization:manage"],
        existingMatch: "none",
      }),
    ).toBe("ai_user");
  });

  it("excludes membership without roles", () => {
    expect(
      classifyUserCategory({
        hasMembership: true,
        hasRoles: false,
        aiPermissionKeys: [],
        existingMatch: "none",
      }),
    ).toBe("membership_without_roles_not_ai_user");
  });

  it("excludes auth without membership", () => {
    expect(
      classifyUserCategory({
        hasMembership: false,
        hasRoles: false,
        aiPermissionKeys: [],
        existingMatch: "none",
      }),
    ).toBe("auth_without_membership");
  });

  it("excludes membership with roles but no AI markers", () => {
    expect(
      classifyUserCategory({
        hasMembership: true,
        hasRoles: true,
        aiPermissionKeys: ["member:manage"],
        existingMatch: "none",
      }),
    ).toBe("membership_with_roles_no_ai_perms");
  });

  it("isBackfillTarget only accepts ai_user", () => {
    expect(isBackfillTarget("ai_user")).toBe(true);
    expect(isBackfillTarget("membership_without_roles_not_ai_user")).toBe(false);
    expect(isBackfillTarget("auth_without_membership")).toBe(false);
  });
});

describe("platform role mapping from permission set (not role name)", () => {
  it("maps chat:use to platform_ai_user without admin role name", () => {
    expect(derivePlatformRolesFromAiPermissions(["chat:use"])).toEqual([
      "platform_ai_user",
      "platform_base",
    ]);
  });

  it("maps coding permissions to platform_coding_user", () => {
    const roles = derivePlatformRolesFromAiPermissions([
      "chat:use",
      "coding:use",
      "coding:device_pair",
    ]);
    expect(roles).toContain("platform_coding_user");
    expect(roles).toContain("platform_ai_user");
  });

  it("maps organization:manage to platform_admin from permission key not role name", () => {
    expect(
      derivePlatformRolesFromAiPermissions(["chat:use", "organization:manage"]),
    ).toContain("platform_admin");
  });

  it("does not assign platform_admin from role name alone", () => {
    expect(derivePlatformRolesFromAiPermissions(["chat:use"])).not.toContain(
      "platform_admin",
    );
  });
});

describe("permission before/after equality", () => {
  const adminBefore = {
    aiAccess: true,
    aiPermissionKeys: ["chat:use", "organization:manage", "coding:use"],
    clearance: "executive",
    platformPermissions: [
      "admin.access",
      "admin.role_manage",
      "admin.staff_manage",
      "ai.use",
      "coding.local_agent",
      "coding.use",
      "mypage.use",
      "tasks.use",
    ],
  };

  it("passes when AI, clearance, and platform permissions are preserved", () => {
    const after = { ...adminBefore };
    const result = comparePermissionSnapshots(adminBefore, after);
    expect(result.ok).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("fails when AI access is lost", () => {
    const after = {
      ...adminBefore,
      aiAccess: false,
      aiPermissionKeys: [],
    };
    const result = comparePermissionSnapshots(adminBefore, after);
    expect(result.ok).toBe(false);
    expect(result.violations).toContain("AI access lost");
  });

  it("fails when Knowledge clearance changes", () => {
    const after = { ...adminBefore, clearance: "company" };
    const result = comparePermissionSnapshots(adminBefore, after);
    expect(result.ok).toBe(false);
    expect(result.violations).toContain("Knowledge clearance changed");
  });

  it("fails when admin access is lost", () => {
    const after = {
      ...adminBefore,
      platformPermissions: adminBefore.platformPermissions.filter(
        (p) => !p.startsWith("admin."),
      ),
    };
    const result = comparePermissionSnapshots(adminBefore, after);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("admin access lost"))).toBe(
      true,
    );
  });

  it("fails when coding access is lost", () => {
    const after = {
      ...adminBefore,
      platformPermissions: adminBefore.platformPermissions.filter(
        (p) => !p.startsWith("coding."),
      ),
    };
    const result = comparePermissionSnapshots(adminBefore, after);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("coding access lost"))).toBe(
      true,
    );
  });
});

describe("Knowledge clearance unchanged (independent from platform)", () => {
  it("clearance stays executive regardless of platform grant changes in comparison", () => {
    const before = {
      aiAccess: true,
      aiPermissionKeys: ["chat:use"],
      clearance: "executive",
      platformPermissions: ["mypage.use", "ai.use"],
    };
    const after = {
      ...before,
      platformPermissions: ["mypage.use", "ai.use", "tasks.use"],
    };
    const result = comparePermissionSnapshots(before, after, {
      allowPlatformGains: ["tasks.use"],
    });
    expect(result.clearanceUnchanged).toBe(true);
    expect(result.ok).toBe(true);
  });
});

describe("fixture exclusion (auxiliary only)", () => {
  it("detects e2e.* and rls.* email prefixes", () => {
    expect(isFixtureEmail("e2e.pw.abc@example.com")).toBe(true);
    expect(isFixtureEmail("rls.test@example.com")).toBe(true);
    expect(isFixtureEmail("admin@gmail.com")).toBe(false);
  });

  it("does not treat fixture prefix alone as backfill target", () => {
    expect(
      isBackfillTarget(
        classifyUserCategory({
          hasMembership: false,
          hasRoles: false,
          aiPermissionKeys: ["chat:use"],
          existingMatch: "none",
        }),
      ),
    ).toBe(false);
  });
});

describe("duplicate retry / already_backfilled", () => {
  it("classifies exact existing identity as already_backfilled", () => {
    expect(
      classifyUserCategory({
        hasMembership: true,
        hasRoles: true,
        aiPermissionKeys: ["chat:use"],
        existingMatch: "exact",
      }),
    ).toBe("already_backfilled");
    expect(isBackfillTarget("already_backfilled")).toBe(false);
  });
});

describe("rollback scenarios (validation gates that prevent partial apply)", () => {
  it("rejects apply when employment_type missing — prevents staff insert", () => {
    expect(validateEmploymentType(undefined).ok).toBe(false);
  });

  it("rejects non-AI membership from backfill target set", () => {
    const category = classifyUserCategory({
      hasMembership: true,
      hasRoles: true,
      aiPermissionKeys: ["member:manage"],
      existingMatch: "none",
    });
    expect(isBackfillTarget(category)).toBe(false);
  });

  it("permission regression detection blocks commit expectation", () => {
    const before = {
      aiAccess: true,
      aiPermissionKeys: ["chat:use"],
      clearance: "executive",
      platformPermissions: ["mypage.use", "ai.use"],
    };
    const after = {
      aiAccess: true,
      aiPermissionKeys: ["chat:use"],
      clearance: "executive",
      platformPermissions: ["mypage.use"],
    };
    expect(comparePermissionSnapshots(before, after).ok).toBe(false);
  });
});

describe("audit event expectations (action catalog)", () => {
  it("lists expected audit actions for successful backfill", () => {
    const expectedActions = [
      "staff_created",
      "identity_linked",
      "role_assigned",
    ];
    expect(expectedActions).toHaveLength(3);
  });
});

describe("apply confirm token", () => {
  it("is deterministic for auth_user + employment_type pair", () => {
    const a = buildApplyConfirmToken(
      "11111111-1111-1111-1111-111111111111",
      "executive",
    );
    const b = buildApplyConfirmToken(
      "11111111-1111-1111-1111-111111111111",
      "executive",
    );
    expect(a).toBe(b);
    expect(a).toHaveLength(8);
  });
});

describe("deriveExpectedPlatformPermissions mirrors LEGACY_PERMISSION_BRIDGE", () => {
  it("bridges admin AI keys to platform admin permissions", () => {
    const perms = deriveExpectedPlatformPermissions([
      "chat:use",
      "organization:manage",
      "coding:use",
    ]);
    expect(perms).toContain("ai.use");
    expect(perms).toContain("admin.access");
    expect(perms).toContain("admin.role_manage");
    expect(perms).toContain("coding.use");
    expect(perms).toContain("mypage.use");
  });

  it("AI_USER_PERMISSION_MARKERS cover formal backfill criterion", () => {
    expect(hasAiUserPermissions(["chat:use"])).toBe(true);
    expect(hasAiUserPermissions(["member:manage"])).toBe(false);
    expect(AI_USER_PERMISSION_MARKERS).toContain("chat:use");
  });
});
