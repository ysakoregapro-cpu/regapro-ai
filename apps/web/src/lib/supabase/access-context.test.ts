import { describe, expect, it } from "vitest";
import { buildAccessContextFromMembership } from "./access-context";
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
});
