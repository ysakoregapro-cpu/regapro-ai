import { describe, expect, it } from "vitest";
import {
  canAccessConfidentialityLevel,
  canAssignConfidentialityLevel,
  isStaffOnlySession,
} from "@regapro/security";
import { hasPermission } from "@regapro/platform";
import {
  buildAccessContextFromMembership,
  buildAccessContextFromStaff,
} from "./access-context";
import type { LiveMembership } from "./membership-types";

const sample: LiveMembership = {
  userId: "11111111-1111-1111-1111-111111111111",
  email: "admin@example.com",
  displayName: "管理者",
  organizationId: "22222222-2222-2222-2222-222222222222",
  organizationName: "株式会社レガプロ",
  membershipId: "33333333-3333-3333-3333-333333333333",
  departmentId: "44444444-4444-4444-4444-444444444444",
  departmentKey: "executive_strategy",
  departmentLabel: "経営戦略部",
  roles: ["admin"],
  permissionKeys: ["chat:use", "clearance:manage"],
  clearanceOverride: null,
  effectiveClearanceRank: 3,
};

describe("buildAccessContextFromMembership", () => {
  it("builds AccessContext with clearance from department", () => {
    const bundle = buildAccessContextFromMembership(sample);
    expect(bundle.access.organizationId).toBe(sample.organizationId);
    expect(bundle.access.departmentKey).toBe("executive_strategy");
    expect(bundle.maximumConfidentialityLevel).toBe("executive");
    expect(bundle.permissions).toContain("clearance:manage");
  });

  it("does not imply conversation audit from executive clearance alone", () => {
    const member: LiveMembership = {
      ...sample,
      roles: ["manager"],
      permissionKeys: ["chat:use"],
      departmentKey: "executive_strategy",
    };
    const bundle = buildAccessContextFromMembership(member);
    expect(bundle.permissions).not.toContain("conversation:audit");
  });

  it("keeps identity fields for membership users", () => {
    const bundle = buildAccessContextFromMembership(sample);
    expect(bundle.membership?.membershipId).toBe(sample.membershipId);
    expect(bundle.identity.userId).toBe(sample.userId);
    expect(bundle.identity.organizationId).toBe(sample.organizationId);
  });

  it("does not regress AI permission keys or executive clearance", () => {
    const bundle = buildAccessContextFromMembership(sample);
    expect(bundle.access.membershipId).toBe(sample.membershipId);
    expect(bundle.access.roleKeys).toEqual(["admin"]);
    expect(bundle.access.permissionKeys).toEqual(
      expect.arrayContaining(["chat:use", "clearance:manage"]),
    );
    expect(bundle.maximumConfidentialityLevel).toBe("executive");
    expect(canAssignConfidentialityLevel(bundle.access, "people")).toBe(true);
    expect(canAssignConfidentialityLevel(bundle.access, "executive")).toBe(true);
    expect(isStaffOnlySession(bundle.access)).toBe(false);
  });
});

describe("buildAccessContextFromStaff", () => {
  it("creates a staff-only session at company clearance", () => {
    const bundle = buildAccessContextFromStaff({
      userId: "auth-1",
      email: "part@example.com",
      displayName: "山田",
      staff: {
        staffId: "staff-1",
        organizationId: "org-1",
        staffNo: "RP-000010",
        name: "山田",
        employmentType: "part_time",
        status: "active",
        joinedAt: null,
        leftAt: null,
        departmentIds: ["dept-ops"],
        primaryDepartmentId: "dept-ops",
      },
      grants: [
        {
          permission: "weekly_pay.submit",
          scope: { type: "self", id: "staff-1" },
          effect: "allow",
          source: "role",
          roleId: "role-1",
        },
      ],
      roleIds: ["role-1"],
    });

    expect(bundle.membership).toBeNull();
    expect(isStaffOnlySession(bundle.access)).toBe(true);
    expect(bundle.access.staffId).toBe("staff-1");
    expect(bundle.access.staffNo).toBe("RP-000010");
    expect(bundle.access.employmentType).toBe("part_time");
    expect(bundle.access.roleKeys).toEqual([]);
    expect(bundle.access.permissionKeys).toEqual([]);
    expect(bundle.permissions).toEqual([]);
    expect(bundle.maximumConfidentialityLevel).toBe("company");
    expect(canAssignConfidentialityLevel(bundle.access, "people")).toBe(false);
    expect(bundle.access.permissions ?? []).toHaveLength(1);
    expect(bundle.access.permissions?.[0]?.permission).toBe("weekly_pay.submit");
    expect(hasPermission(bundle.access, "weekly_pay.submit")).toBe(true);
    expect(hasPermission(bundle.access, "expense.manage")).toBe(false);
    expect(canAccessConfidentialityLevel(bundle.access, "company")).toBe(true);
    expect(canAccessConfidentialityLevel(bundle.access, "people")).toBe(false);
    expect(canAccessConfidentialityLevel(bundle.access, "executive")).toBe(false);
  });
});
