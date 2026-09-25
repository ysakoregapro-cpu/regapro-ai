import type { PlatformPermission } from "@regapro/shared";

/**
 * Platform role templates — named permission bundles, not job titles.
 * Employment type is never a grant source. Mirrors the seed in
 * `supabase/migrations/*_work_permission_foundation.sql`.
 */

export const PLATFORM_ROLE_TEMPLATES = {
  platform_weekly_pay_submitter: ["weekly_pay.submit"],
  platform_weekly_pay_reviewer: ["weekly_pay.review"],
  platform_weekly_pay_payer: ["weekly_pay.pay"],
  platform_weekly_pay_manager: ["weekly_pay.submit", "weekly_pay.manage"],
  platform_weekly_pay_policy_manager: ["weekly_pay.policy_manage"],
  platform_shift_user: ["shift.view_own", "shift.request"],
  platform_shift_manager: ["shift.manage"],
  platform_admin: [
    "admin.access",
    "admin.staff_manage",
    "admin.role_manage",
    "weekly_pay.submit",
    "weekly_pay.review",
    "weekly_pay.pay",
    "weekly_pay.manage",
    "weekly_pay.policy_manage",
    "shift.view_own",
    "shift.request",
    "shift.manage",
    "documents.use",
    "documents.manage",
  ],
} as const satisfies Record<string, readonly PlatformPermission[]>;

export type PlatformRoleTemplateKey = keyof typeof PLATFORM_ROLE_TEMPLATES;

export function permissionsForRoleTemplate(
  key: PlatformRoleTemplateKey,
): readonly PlatformPermission[] {
  return PLATFORM_ROLE_TEMPLATES[key];
}
