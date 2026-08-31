import { describe, expect, it } from "vitest";
import {
  isMissingRelation,
  loadGrants,
  loadStaffRecord,
  type PlatformQueryClient,
} from "./staff-queries";

type Filter = { column: string; value: string | null };
type Recorded = { relation: string; filters: Filter[] };

/**
 * Minimal in-memory PostgREST stand-in. It records the filters each query
 * applied so tests can assert tenant scoping, not just the returned rows.
 */
function fakeClient(
  responses: Record<string, { data: unknown; error?: { message: string; code?: string } }>,
  recorded: Recorded[] = [],
): PlatformQueryClient {
  return {
    from(relation) {
      const entry: Recorded = { relation, filters: [] };
      recorded.push(entry);
      const result = responses[relation] ?? { data: null };
      const settled = Promise.resolve({
        data: result.data,
        error: result.error ?? null,
      });

      const builder = {
        select: () => builder,
        eq: (column: string, value: string) => {
          entry.filters.push({ column, value });
          return builder;
        },
        is: (column: string, value: null) => {
          entry.filters.push({ column, value });
          return builder;
        },
        limit: () => builder,
        maybeSingle: () => settled,
        then: settled.then.bind(settled),
      } as unknown as ReturnType<PlatformQueryClient["from"]>;

      return builder;
    },
  };
}

const STAFF_ROW = {
  staff_id: "staff-1",
  org_id: "org-a",
  staff_no: "S-0001",
  name: "山田太郎",
  employment_type: "part_time",
  status: "active",
  joined_at: "2026-04-01",
  left_at: null,
};

describe("auth user to staff resolution", () => {
  it("resolves a linked login identity to its staff record", async () => {
    const client = fakeClient({
      staff_identities: { data: { staff_id: "staff-1" } },
      staff: { data: STAFF_ROW },
      staff_departments: {
        data: [
          { department_id: "dept-sales", is_primary: true },
          { department_id: "dept-people", is_primary: false },
        ],
      },
    });

    const result = await loadStaffRecord(client, "auth-user-1");
    expect(result.kind).toBe("found");
    if (result.kind !== "found") return;
    expect(result.staff.staffId).toBe("staff-1");
    expect(result.staff.staffNo).toBe("S-0001");
    expect(result.staff.employmentType).toBe("part_time");
    expect(result.staff.departmentIds).toEqual(["dept-sales", "dept-people"]);
    expect(result.staff.primaryDepartmentId).toBe("dept-sales");
  });

  it("looks the identity up by auth_user_id and app_auth type", async () => {
    const recorded: Recorded[] = [];
    const client = fakeClient({ staff_identities: { data: null } }, recorded);
    await loadStaffRecord(client, "auth-user-1");

    expect(recorded[0]?.relation).toBe("staff_identities");
    expect(recorded[0]?.filters).toEqual([
      { column: "auth_user_id", value: "auth-user-1" },
      { column: "identity_type", value: "app_auth" },
    ]);
  });

  it("reports unlinked when the login has no staff identity", async () => {
    const client = fakeClient({ staff_identities: { data: null } });
    expect((await loadStaffRecord(client, "auth-user-1")).kind).toBe("unlinked");
  });

  it("reports unavailable before the migrations are applied", async () => {
    const client = fakeClient({
      staff_identities: {
        data: null,
        error: { message: "relation does not exist", code: "PGRST205" },
      },
    });
    expect((await loadStaffRecord(client, "auth-user-1")).kind).toBe("unavailable");
  });

  it("rejects a staff row with an unrecognised employment type", async () => {
    const client = fakeClient({
      staff_identities: { data: { staff_id: "staff-1" } },
      staff: { data: { ...STAFF_ROW, employment_type: "intern" } },
    });
    expect((await loadStaffRecord(client, "auth-user-1")).kind).toBe("unlinked");
  });
});

describe("missing relation detection", () => {
  it("recognises PostgREST and Postgres unknown-relation codes", () => {
    expect(isMissingRelation({ message: "x", code: "PGRST205" })).toBe(true);
    expect(isMissingRelation({ message: "x", code: "42P01" })).toBe(true);
    expect(isMissingRelation({ message: "relation does not exist" })).toBe(true);
  });

  it("does not treat a permission denial as a missing relation", () => {
    expect(isMissingRelation({ message: "permission denied", code: "42501" })).toBe(
      false,
    );
    expect(isMissingRelation(null)).toBe(false);
  });
});

describe("grant loading", () => {
  const assignments = {
    data: [
      {
        role_id: "role-weekly",
        scope_type: "self",
        scope_id: null,
        roles: {
          id: "role-weekly",
          deleted_at: null,
          role_permissions: [
            { deleted_at: null, permissions: { key: "weekly_pay.submit", deleted_at: null } },
            { deleted_at: null, permissions: { key: "chat:use", deleted_at: null } },
            { deleted_at: null, permissions: { key: "mypage.use", deleted_at: "2026-01-01" } },
          ],
        },
      },
      {
        role_id: "role-deleted",
        scope_type: "organization",
        scope_id: null,
        roles: { id: "role-deleted", deleted_at: "2026-01-01", role_permissions: [] },
      },
    ],
  };

  it("builds scoped grants and skips non-platform keys", async () => {
    const client = fakeClient({
      staff_role_assignments: assignments,
      staff_permission_overrides: { data: [] },
    });

    const { grants, roleIds } = await loadGrants(client, {
      staffId: "staff-1",
      organizationId: "org-a",
    });

    expect(grants).toEqual([
      {
        permission: "weekly_pay.submit",
        scope: { type: "self", id: "staff-1" },
        effect: "allow",
        source: "role",
        roleId: "role-weekly",
      },
    ]);
    expect(roleIds).toEqual(["role-weekly"]);
  });

  it("filters every grant query by organization for tenant isolation", async () => {
    const recorded: Recorded[] = [];
    const client = fakeClient(
      { staff_role_assignments: { data: [] }, staff_permission_overrides: { data: [] } },
      recorded,
    );

    await loadGrants(client, { staffId: "staff-1", organizationId: "org-a" });

    for (const query of recorded) {
      expect(query.filters).toContainEqual({ column: "org_id", value: "org-a" });
      expect(query.filters).toContainEqual({ column: "staff_id", value: "staff-1" });
      expect(query.filters).toContainEqual({ column: "deleted_at", value: null });
    }
  });

  it("carries deny overrides through so they can beat role grants", async () => {
    const client = fakeClient({
      staff_role_assignments: assignments,
      staff_permission_overrides: {
        data: [
          {
            effect: "deny",
            scope_type: "organization",
            scope_id: null,
            permissions: { key: "weekly_pay.submit", deleted_at: null },
          },
        ],
      },
    });

    const { grants } = await loadGrants(client, {
      staffId: "staff-1",
      organizationId: "org-a",
    });
    expect(grants.filter((g) => g.effect === "deny")).toHaveLength(1);
  });
});
