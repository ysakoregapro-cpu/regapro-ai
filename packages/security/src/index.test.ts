import { describe, expect, it } from "vitest";
import {
  buildAccessContext,
  canAssignConfidentialityLevel,
  canLowerResourceLevel,
  canReadPrivateThread,
  classifySensitiveContent,
  createInheritedChildLabel,
  effectiveSearchCeiling,
  filterResourcesByAccess,
  hasPermission,
} from "./index.js";

describe("permissions include conversation audit separation", () => {
  it("manager does not get conversation:audit by default", () => {
    expect(
      hasPermission({ roles: ["manager"] }, "conversation:audit"),
    ).toBe(false);
  });

  it("admin can audit", () => {
    expect(hasPermission({ roles: ["admin"] }, "conversation:audit")).toBe(
      true,
    );
  });
});

describe("classification", () => {
  it("keeps market salary at company", () => {
    const r = classifySensitiveContent("営業職の平均給与をWebで調べて");
    expect(r.suggestedLevel).toBe("company");
  });

  it("marks real employee pay as executive", () => {
    const r = classifySensitiveContent("酒匂さんの実給与を教えて");
    expect(r.suggestedLevel).toBe("executive");
    expect(r.requiresConfirmation).toBe(true);
  });

  it("marks resume as people", () => {
    const r = classifySensitiveContent("応募者の履歴書を要約して");
    expect(r.suggestedLevel).toBe("people");
  });

  it("keeps recruiting howto at company", () => {
    const r = classifySensitiveContent("採用ノウハウをまとめて");
    expect(r.suggestedLevel).toBe("company");
  });

  it("marks board materials as executive", () => {
    const r = classifySensitiveContent("経営会議資料の要点をまとめて");
    expect(r.suggestedLevel).toBe("executive");
  });

  it("allows general payroll formula at company", () => {
    const r = classifySensitiveContent("給与計算の一般的な式を教えて");
    expect(r.suggestedLevel).toBe("company");
  });
});

describe("access context & retrieval", () => {
  const sales = buildAccessContext({
    userId: "u-sales",
    organizationId: "org",
    membershipId: "m1",
    departmentId: "d-sales",
    departmentKey: "sales",
    roles: ["member"],
  });

  const people = buildAccessContext({
    userId: "u-people",
    organizationId: "org",
    membershipId: "m2",
    departmentId: "d-people",
    departmentKey: "people",
    roles: ["editor"],
  });

  const executive = buildAccessContext({
    userId: "u-exec",
    organizationId: "org",
    membershipId: "m3",
    departmentId: "d-exec",
    departmentKey: "executive_strategy",
    roles: ["manager"],
  });

  it("sales max clearance is company", () => {
    expect(sales.maximumConfidentialityLevel).toBe("company");
    expect(canAssignConfidentialityLevel(sales, "people")).toBe(false);
  });

  it("people can select company and people", () => {
    expect(canAssignConfidentialityLevel(people, "people")).toBe(true);
    expect(canAssignConfidentialityLevel(people, "executive")).toBe(false);
  });

  it("thread ceiling caps executive user at company for L1 thread", () => {
    const ctx = buildAccessContext({
      ...executive,
      departmentKey: "executive_strategy",
      roles: ["manager"],
      userId: executive.userId,
      organizationId: executive.organizationId,
      membershipId: executive.membershipId,
      departmentId: executive.departmentId,
      threadConfidentialityLevel: "company",
    });
    expect(effectiveSearchCeiling(ctx)).toBe("company");
  });

  it("does not return L2/L3 knowledge into L1 thread", () => {
    const ctx = buildAccessContext({
      userId: people.userId,
      organizationId: "org",
      membershipId: "m2",
      departmentId: "d-people",
      departmentKey: "people",
      roles: ["editor"],
      threadConfidentialityLevel: "company",
    });
    const filtered = filterResourcesByAccess(ctx, [
      {
        id: "k1",
        confidentialityLevel: "company" as const,
        visibility: "organization" as const,
        ownerUserId: "u",
      },
      {
        id: "k2",
        confidentialityLevel: "people" as const,
        visibility: "organization" as const,
        ownerUserId: "u",
      },
      {
        id: "k3",
        confidentialityLevel: "executive" as const,
        visibility: "organization" as const,
        ownerUserId: "u",
      },
    ]);
    expect(filtered.map((x) => x.id)).toEqual(["k1"]);
  });

  it("excludes other users private chats", () => {
    const filtered = filterResourcesByAccess(sales, [
      {
        id: "t-own",
        confidentialityLevel: "company" as const,
        visibility: "private" as const,
        ownerUserId: "u-sales",
      },
      {
        id: "t-other",
        confidentialityLevel: "company" as const,
        visibility: "private" as const,
        ownerUserId: "u-other",
      },
    ]);
    expect(filtered.map((x) => x.id)).toEqual(["t-own"]);
  });

  it("executive still cannot audit private without conversation:audit", () => {
    expect(
      canReadPrivateThread(executive, {
        id: "t1",
        ownerUserId: "someone-else",
        visibility: "private",
      }),
    ).toBe(false);
  });
});

describe("inheritance & lower prevention", () => {
  it("inherits level to artifact", () => {
    const child = createInheritedChildLabel(
      {
        confidentialityLevel: "executive",
        visibility: "private",
        ownerUserId: "u1",
      },
      { threadId: "th1", messageId: "m1" },
    );
    expect(child.confidentialityLevel).toBe("executive");
    expect(child.originThreadId).toBe("th1");
  });

  it("blocks lowering when children are higher", () => {
    const result = canLowerResourceLevel({
      currentLevel: "executive",
      newLevel: "company",
      childLevels: ["executive"],
    });
    expect(result.allowed).toBe(false);
    expect(result.advice).toContain("新しいスレッド");
  });
});
