import type { StaffRecord } from "@regapro/platform";
import type { LiveMembership } from "./membership-types";
import type { StaffLookupResult } from "@/lib/platform/staff-queries";

/**
 * Login / session admission — membership OR active staff, never a synthetic
 * organization_memberships row.
 *
 * A. usable AI membership → legacy session (staff may be inactive or absent)
 * B. no membership + active app_auth staff → staff-only session
 * C. neither → deny
 * D. no membership + inactive staff → deny
 */

export type LoginAdmissionCode =
  | "STAFF_INACTIVE"
  | "NO_PLATFORM_IDENTITY";

export type LoginAdmissionDecision =
  | { ok: true; kind: "legacy_membership"; membership: LiveMembership }
  | { ok: true; kind: "staff_only"; staff: StaffRecord }
  | { ok: false; code: LoginAdmissionCode; message: string };

export const LOGIN_DENIAL_MESSAGES: Record<LoginAdmissionCode, string> = {
  STAFF_INACTIVE:
    "このアカウントは現在利用できません。管理者に確認してください。",
  NO_PLATFORM_IDENTITY:
    "組織メンバーシップがありません。管理者に招待を依頼してください。",
};

export function decideLoginAdmission(input: {
  membership: LiveMembership | null;
  staff: StaffLookupResult;
}): LoginAdmissionDecision {
  if (input.membership) {
    return {
      ok: true,
      kind: "legacy_membership",
      membership: input.membership,
    };
  }

  if (input.staff.kind === "found") {
    if (input.staff.staff.status !== "active") {
      return {
        ok: false,
        code: "STAFF_INACTIVE",
        message: LOGIN_DENIAL_MESSAGES.STAFF_INACTIVE,
      };
    }
    return { ok: true, kind: "staff_only", staff: input.staff.staff };
  }

  return {
    ok: false,
    code: "NO_PLATFORM_IDENTITY",
    message: LOGIN_DENIAL_MESSAGES.NO_PLATFORM_IDENTITY,
  };
}
