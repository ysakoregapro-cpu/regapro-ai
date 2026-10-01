import { describe, expect, it } from "vitest";
import {
  assertNoEmailConfirmLoophole,
  resolveLegacyPerson,
} from "./legacy-identity-resolve.js";

const staffA = {
  staff_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  record_kind: "operational" as const,
  status: "active",
};
const staffFix = {
  staff_id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
  record_kind: "fixture" as const,
  status: "active",
};

function baseMaps(
  extra: Partial<Parameters<typeof resolveLegacyPerson>[0]> = {},
): Parameters<typeof resolveLegacyPerson>[0] {
  return {
    row: { id: "legacy-1" },
    legacyEmailByUserId: new Map(),
    approvedByExternal: new Map(),
    staffById: new Map([
      [staffA.staff_id, staffA],
      [staffFix.staff_id, staffFix],
    ]),
    byAuth: new Map(),
    byStaffNo: new Map(),
    byLegacyExternal: new Map(),
    byEmailMd5: new Map(),
    crossProjectEmailMd5: new Set(),
    normalizeCode: (v: string) => v.trim().toLowerCase(),
    ...extra,
  };
}

describe("resolveLegacyPerson", () => {
  it("confirms only via approved identity map", () => {
    const r = resolveLegacyPerson(
      baseMaps({
        approvedByExternal: new Map([["legacy-1", staffA.staff_id]]),
        byEmailMd5: new Map([["md5", [staffA.staff_id]]]),
        legacyEmailByUserId: new Map([
          ["legacy-1", { confirmed: true, email_md5: "md5" }],
        ]),
      }),
    );
    expect(r.kind).toBe("confirmed");
    expect(r.methods).toEqual(["approved_identity"]);
  });

  it("never confirms from email alone", () => {
    const r = resolveLegacyPerson(
      baseMaps({
        byEmailMd5: new Map([["md5", [staffA.staff_id]]]),
        legacyEmailByUserId: new Map([
          ["legacy-1", { confirmed: true, email_md5: "md5" }],
        ]),
      }),
    );
    expect(r.kind).toBe("candidate");
    expect(r.methods).toContain("email_verified_candidate");
  });

  it("never confirms from auth_user_id alone", () => {
    const r = resolveLegacyPerson(
      baseMaps({
        row: { id: "legacy-1", auth_user_id: "auth-1" },
        byAuth: new Map([["auth-1", [staffA.staff_id]]]),
      }),
    );
    expect(r.kind).toBe("candidate");
    expect(r.methods).toContain("auth_user_id_candidate");
  });

  it("ignores fixture staff for email candidates", () => {
    const r = resolveLegacyPerson(
      baseMaps({
        byEmailMd5: new Map([["md5", [staffFix.staff_id]]]),
        legacyEmailByUserId: new Map([
          ["legacy-1", { confirmed: true, email_md5: "md5" }],
        ]),
      }),
    );
    expect(r.kind).toBe("unmatched");
  });

  it("flags cross-project email as needing org/person confirm", () => {
    const r = resolveLegacyPerson(
      baseMaps({
        byEmailMd5: new Map([["md5", [staffA.staff_id]]]),
        crossProjectEmailMd5: new Set(["md5"]),
        legacyEmailByUserId: new Map([
          ["legacy-1", { confirmed: true, email_md5: "md5" }],
        ]),
      }),
    );
    expect(r.kind).toBe("candidate_needs_org_person_confirm");
  });
});

describe("assertNoEmailConfirmLoophole", () => {
  it("refuses --confirm-email-matches", () => {
    expect(() =>
      assertNoEmailConfirmLoophole(["--entity", "expense", "--confirm-email-matches"]),
    ).toThrow(/REFUSED/);
  });

  it("allows normal argv", () => {
    expect(() => assertNoEmailConfirmLoophole(["--entity", "expense"])).not.toThrow();
  });
});
