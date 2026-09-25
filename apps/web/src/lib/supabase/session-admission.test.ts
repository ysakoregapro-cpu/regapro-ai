import { describe, expect, it } from "vitest";
import type { StaffRecord } from "@regapro/platform";
import { decideLoginAdmission } from "./session-admission";
import type { LiveMembership } from "./membership-types";

const membership: LiveMembership = {
  userId: "auth-member",
  email: "ai@example.com",
  displayName: "AI利用者",
  organizationId: "org-1",
  organizationName: "株式会社レガプロ",
  membershipId: "mem-1",
  departmentId: "dept-sales",
  departmentKey: "sales",
  departmentLabel: "営業部",
  roles: ["member"],
  permissionKeys: ["chat:use", "task:read"],
  clearanceOverride: null,
  effectiveClearanceRank: 1,
};

const activeStaff: StaffRecord = {
  staffId: "staff-1",
  organizationId: "org-1",
  staffNo: "RP-000011",
  name: "アルバイト",
  employmentType: "part_time",
  status: "active",
  joinedAt: null,
  leftAt: null,
  departmentIds: [],
  primaryDepartmentId: null,
};

describe("decideLoginAdmission", () => {
  it("admits a membership user even without a staff record", () => {
    const decision = decideLoginAdmission({
      membership,
      staff: { kind: "unlinked" },
    });
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.kind).toBe("legacy_membership");
  });

  it("admits a membership + staff user as the legacy path", () => {
    const decision = decideLoginAdmission({
      membership,
      staff: { kind: "found", staff: activeStaff },
    });
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.kind).toBe("legacy_membership");
  });

  it("admits membership users whose staff row is inactive", () => {
    const decision = decideLoginAdmission({
      membership,
      staff: {
        kind: "found",
        staff: { ...activeStaff, status: "suspended" },
      },
    });
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.kind).toBe("legacy_membership");
  });

  it("admits staff-only active app_auth staff", () => {
    const decision = decideLoginAdmission({
      membership: null,
      staff: { kind: "found", staff: activeStaff },
    });
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.kind).toBe("staff_only");
    if (decision.kind !== "staff_only") return;
    expect(decision.staff.staffId).toBe("staff-1");
    expect(decision.staff.employmentType).toBe("part_time");
  });

  it("denies inactive staff without membership", () => {
    const decision = decideLoginAdmission({
      membership: null,
      staff: {
        kind: "found",
        staff: { ...activeStaff, status: "left" },
      },
    });
    expect(decision).toMatchObject({ ok: false, code: "STAFF_INACTIVE" });
  });

  it("denies an unlinked login with no membership", () => {
    const decision = decideLoginAdmission({
      membership: null,
      staff: { kind: "unlinked" },
    });
    expect(decision).toMatchObject({ ok: false, code: "NO_PLATFORM_IDENTITY" });
  });

  it("denies auth-only when staff tables are unavailable", () => {
    const decision = decideLoginAdmission({
      membership: null,
      staff: { kind: "unavailable" },
    });
    expect(decision).toMatchObject({ ok: false, code: "NO_PLATFORM_IDENTITY" });
  });
});
