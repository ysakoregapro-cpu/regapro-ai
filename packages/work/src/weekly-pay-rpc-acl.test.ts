import { describe, expect, it } from "vitest";
import {
  expectedWeeklyPayExecute,
  WEEKLY_PAY_BUSINESS_RPC_IDENTITIES,
  WEEKLY_PAY_INTERNAL_HELPER_IDENTITIES,
  WEEKLY_PAY_RLS_HELPER_IDENTITIES,
  WEEKLY_PAY_RPC_ACL,
} from "./weekly-pay-rpc-acl.js";

describe("weekly pay RPC ACL contract", () => {
  it("keeps business RPCs authenticated + service_role", () => {
    expect(WEEKLY_PAY_BUSINESS_RPC_IDENTITIES.length).toBeGreaterThanOrEqual(5);
    expect(WEEKLY_PAY_RPC_ACL.business).toEqual({
      anon: false,
      authenticated: true,
      service_role: true,
    });
    expect(expectedWeeklyPayExecute("business", "anon")).toBe(false);
  });

  it("keeps internal helpers owner-only", () => {
    expect(WEEKLY_PAY_INTERNAL_HELPER_IDENTITIES.length).toBeGreaterThan(0);
    expect(expectedWeeklyPayExecute("internal", "anon")).toBe(false);
    expect(expectedWeeklyPayExecute("internal", "authenticated")).toBe(false);
    expect(expectedWeeklyPayExecute("internal", "service_role")).toBe(false);
  });

  it("exposes one RLS helper", () => {
    expect(WEEKLY_PAY_RLS_HELPER_IDENTITIES).toEqual([
      "public.regapro_has_any_weekly_pay_permission(uuid)",
    ]);
  });

  it("keeps CSV payload service_role-only", () => {
    expect(WEEKLY_PAY_RPC_ACL.serviceOnly).toEqual({
      anon: false,
      authenticated: false,
      service_role: true,
    });
    expect(expectedWeeklyPayExecute("serviceOnly", "authenticated")).toBe(false);
    expect(expectedWeeklyPayExecute("serviceOnly", "service_role")).toBe(true);
  });
});
