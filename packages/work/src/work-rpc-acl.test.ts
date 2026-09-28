import { describe, expect, it } from "vitest";
import {
  expectedExecute,
  SHIFT_WORK_BUSINESS_RPC_IDENTITIES,
  SHIFT_WORK_INTERNAL_HELPER_IDENTITIES,
  SHIFT_WORK_RLS_HELPER_IDENTITIES,
  SHIFT_WORK_RPC_ACL,
} from "./work-rpc-acl.js";

describe("Phase 2/3 SECURITY DEFINER ACL contract", () => {
  it("allows only authenticated and service_role on business RPCs", () => {
    expect(SHIFT_WORK_BUSINESS_RPC_IDENTITIES).toHaveLength(11);
    expect(SHIFT_WORK_RPC_ACL.business).toEqual({
      anon: false,
      authenticated: true,
      service_role: true,
    });
    expect(expectedExecute("business", "anon")).toBe(false);
    expect(expectedExecute("business", "authenticated")).toBe(true);
    expect(expectedExecute("business", "service_role")).toBe(true);
  });

  it("allows only authenticated and service_role on RLS helpers", () => {
    expect(SHIFT_WORK_RLS_HELPER_IDENTITIES).toEqual([
      "public.regapro_has_any_shift_permission(uuid)",
      "public.regapro_has_any_work_record_permission(uuid)",
    ]);
    expect(expectedExecute("rlsHelper", "anon")).toBe(false);
    expect(expectedExecute("rlsHelper", "authenticated")).toBe(true);
  });

  it("revokes anon, authenticated, and service_role from internal helpers", () => {
    expect(SHIFT_WORK_INTERNAL_HELPER_IDENTITIES).toContain(
      "public.regapro_lock_employment_term_scope(uuid, uuid)",
    );
    expect(SHIFT_WORK_INTERNAL_HELPER_IDENTITIES).toContain(
      "public.regapro_touch_updated_at()",
    );
    expect(SHIFT_WORK_RPC_ACL.internal).toEqual({
      anon: false,
      authenticated: false,
      service_role: false,
    });
    expect(expectedExecute("internal", "anon")).toBe(false);
    expect(expectedExecute("internal", "authenticated")).toBe(false);
    expect(expectedExecute("internal", "service_role")).toBe(false);
  });

  it("does not grant anon EXECUTE on any Phase 2/3 surface", () => {
    expect(expectedExecute("business", "anon")).toBe(false);
    expect(expectedExecute("rlsHelper", "anon")).toBe(false);
    expect(expectedExecute("internal", "anon")).toBe(false);
  });
});
