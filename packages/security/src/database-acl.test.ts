import { describe, expect, it } from "vitest";
import {
  expectedLegacyExecute,
  LEGACY_DATABASE_ACL,
  LEGACY_KNOWLEDGE_AUTHENTICATED_IDENTITIES,
  LEGACY_KNOWLEDGE_SERVICE_ONLY_IDENTITIES,
  LEGACY_OWNER_ONLY_IDENTITIES,
  LEGACY_RLS_HELPER_IDENTITIES,
  LEGACY_SERVICE_ONLY_IDENTITIES,
} from "./database-acl.js";

describe("legacy database ACL contract", () => {
  it("keeps maintenance RPCs service_role-only", () => {
    expect(LEGACY_SERVICE_ONLY_IDENTITIES).toContain(
      "public.regapro_backfill_staff_from_auth(uuid, text, uuid)",
    );
    expect(LEGACY_SERVICE_ONLY_IDENTITIES).toContain(
      "public.regapro_next_staff_no(uuid)",
    );
    expect(LEGACY_DATABASE_ACL.service_only).toEqual({
      anon: false,
      authenticated: false,
      service_role: true,
    });
    expect(expectedLegacyExecute("service_only", "anon")).toBe(false);
    expect(expectedLegacyExecute("service_only", "authenticated")).toBe(false);
    expect(expectedLegacyExecute("service_only", "service_role")).toBe(true);
  });

  it("allows authenticated and service_role on policy-direct RLS helpers", () => {
    expect(LEGACY_RLS_HELPER_IDENTITIES).toHaveLength(15);
    expect(LEGACY_RLS_HELPER_IDENTITIES).toContain(
      "public.regapro_is_org_member(uuid)",
    );
    expect(LEGACY_RLS_HELPER_IDENTITIES).not.toContain(
      "public.regapro_has_any_shift_permission(uuid)",
    );
    expect(LEGACY_RLS_HELPER_IDENTITIES).not.toContain(
      "public.regapro_has_any_work_record_permission(uuid)",
    );
    expect(expectedLegacyExecute("rls_helper", "anon")).toBe(false);
    expect(expectedLegacyExecute("rls_helper", "authenticated")).toBe(true);
    expect(expectedLegacyExecute("rls_helper", "service_role")).toBe(true);
  });

  it("revokes direct EXECUTE on nested and obsolete helpers", () => {
    expect(LEGACY_OWNER_ONLY_IDENTITIES).toContain(
      "public.regapro_can_access_resource(uuid, integer, text, uuid, uuid, uuid)",
    );
    expect(LEGACY_OWNER_ONLY_IDENTITIES).toContain(
      "public.regapro_current_membership_id(uuid)",
    );
    expect(expectedLegacyExecute("owner_only", "anon")).toBe(false);
    expect(expectedLegacyExecute("owner_only", "authenticated")).toBe(false);
    expect(expectedLegacyExecute("owner_only", "service_role")).toBe(false);
  });

  it("keeps knowledge search and claim on authenticated JWT path", () => {
    expect(LEGACY_KNOWLEDGE_AUTHENTICATED_IDENTITIES).toHaveLength(5);
    expect(LEGACY_KNOWLEDGE_SERVICE_ONLY_IDENTITIES).toEqual([]);
    expect(expectedLegacyExecute("knowledge_authenticated", "anon")).toBe(false);
    expect(expectedLegacyExecute("knowledge_authenticated", "authenticated")).toBe(
      true,
    );
    expect(expectedLegacyExecute("knowledge_authenticated", "service_role")).toBe(
      true,
    );
  });

  it("does not grant anon EXECUTE on any legacy surface", () => {
    for (const kind of Object.keys(LEGACY_DATABASE_ACL) as Array<
      keyof typeof LEGACY_DATABASE_ACL
    >) {
      expect(expectedLegacyExecute(kind, "anon")).toBe(false);
    }
  });
});
