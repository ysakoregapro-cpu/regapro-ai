import type { Permission } from "@regapro/shared";
import { EMPLOYMENT_TYPES, type EmploymentType } from "@regapro/shared";
import { LEGACY_PERMISSION_BRIDGE } from "./legacy-compat.js";

/** Permission keys that mark a user as an AI product user (formal backfill criterion). */
export const AI_USER_PERMISSION_MARKERS = [
  "chat:use",
  "coding:use",
  "knowledge:read",
  "research:run",
  "task:read",
] as const satisfies readonly Permission[];

export type UserCategory =
  | "ai_user"
  | "membership_without_roles_not_ai_user"
  | "membership_with_roles_no_ai_perms"
  | "auth_without_membership"
  | "inactive_account"
  | "conflict"
  | "already_backfilled";

/** Maps legacy AI permission keys → platform role template keys (permission-set driven). */
export const PERMISSION_TO_PLATFORM_ROLES: Partial<
  Record<Permission, readonly string[]>
> = {
  "chat:use": ["platform_ai_user"],
  "task:read": ["platform_base"],
  "coding:use": ["platform_coding_user"],
  "coding:device_pair": ["platform_coding_user"],
  "coding:workspace_write": ["platform_coding_user"],
  "member:manage": ["platform_admin"],
  "organization:manage": ["platform_admin"],
  "audit:read": ["platform_admin"],
  "system:diagnose": ["platform_admin"],
};

export const SOURCE_SYSTEM_REGAPRO_APP = "regapro_app";

/** Auxiliary fixture email patterns — never the sole backfill criterion. */
export const FIXTURE_EMAIL_PREFIXES = ["e2e.", "rls."] as const;

export type PermissionSnapshot = {
  aiAccess: boolean;
  aiPermissionKeys: string[];
  clearance: string;
  platformPermissions: string[];
};

export type PermissionPreservationResult = {
  ok: boolean;
  aiPermissionsUnchanged: boolean;
  clearanceUnchanged: boolean;
  platformPermissionsLost: string[];
  platformPermissionsGained: string[];
  violations: string[];
};

export type ApplyValidationResult =
  | { ok: true; employmentType: EmploymentType }
  | { ok: false; reason: string };

export function formatStaffNo(sequenceNumber: number): string {
  if (!Number.isInteger(sequenceNumber) || sequenceNumber < 1) {
    throw new Error(`Invalid staff_no sequence: ${sequenceNumber}`);
  }
  return `RP-${String(sequenceNumber).padStart(6, "0")}`;
}

export function isFixtureEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  return FIXTURE_EMAIL_PREFIXES.some((prefix) => local.startsWith(prefix));
}

export function hasAiUserPermissions(aiPermissionKeys: readonly string[]): boolean {
  return AI_USER_PERMISSION_MARKERS.some((marker) =>
    aiPermissionKeys.includes(marker),
  );
}

export function classifyUserCategory(input: {
  hasMembership: boolean;
  hasRoles: boolean;
  aiPermissionKeys: readonly string[];
  existingMatch: "none" | "exact" | "possible" | "conflict";
  isInactive?: boolean;
}): UserCategory {
  if (input.existingMatch === "exact") return "already_backfilled";
  if (input.existingMatch === "conflict") return "conflict";
  if (input.isInactive) return "inactive_account";
  if (!input.hasMembership) return "auth_without_membership";
  if (!input.hasRoles) return "membership_without_roles_not_ai_user";
  if (hasAiUserPermissions(input.aiPermissionKeys)) return "ai_user";
  return "membership_with_roles_no_ai_perms";
}

export function isBackfillTarget(category: UserCategory): boolean {
  return category === "ai_user";
}

export function validateEmploymentType(
  value: string | null | undefined,
): ApplyValidationResult {
  if (value === null || value === undefined || value.trim() === "") {
    return { ok: false, reason: "employment_type is required (--employment-type)" };
  }
  if (!(EMPLOYMENT_TYPES as readonly string[]).includes(value)) {
    return {
      ok: false,
      reason: `invalid employment_type: ${value}. Must be one of: ${EMPLOYMENT_TYPES.join(", ")}`,
    };
  }
  return { ok: true, employmentType: value as EmploymentType };
}

/**
 * Derives platform role keys from the caller's actual AI permission keys.
 * Never maps from membership role names (e.g. admin) alone.
 */
export function derivePlatformRolesFromAiPermissions(
  aiPermissionKeys: readonly string[],
): string[] {
  const roles = new Set<string>(["platform_base"]);
  for (const key of aiPermissionKeys) {
    for (const role of PERMISSION_TO_PLATFORM_ROLES[key as Permission] ?? []) {
      roles.add(role);
    }
  }
  return [...roles].sort();
}

/** Platform permissions expected after bridging legacy AI keys. */
export function deriveExpectedPlatformPermissions(
  aiPermissionKeys: readonly string[],
): string[] {
  const perms = new Set<string>(["mypage.use"]);
  for (const legacy of aiPermissionKeys) {
    for (const mapped of LEGACY_PERMISSION_BRIDGE[legacy as Permission] ?? []) {
      perms.add(mapped);
    }
  }
  return [...perms].sort();
}

export function comparePermissionSnapshots(
  before: PermissionSnapshot,
  after: PermissionSnapshot,
  options?: { allowPlatformGains?: readonly string[] },
): PermissionPreservationResult {
  const allowGains = new Set(options?.allowPlatformGains ?? []);
  const platformLost = before.platformPermissions.filter(
    (p) => !after.platformPermissions.includes(p),
  );
  const platformGained = after.platformPermissions.filter(
    (p) => !before.platformPermissions.includes(p) && !allowGains.has(p),
  );
  const aiUnchanged =
    JSON.stringify([...before.aiPermissionKeys].sort()) ===
    JSON.stringify([...after.aiPermissionKeys].sort());
  const clearanceUnchanged = before.clearance === after.clearance;

  const violations: string[] = [];
  if (!before.aiAccess && after.aiAccess) {
    // gaining AI is fine
  } else if (before.aiAccess && !after.aiAccess) {
    violations.push("AI access lost");
  }
  if (!aiUnchanged) violations.push("AI permission keys changed");
  if (!clearanceUnchanged) violations.push("Knowledge clearance changed");
  if (platformLost.includes("admin.access")) violations.push("admin access lost");
  if (platformLost.includes("coding.use")) violations.push("coding access lost");
  if (platformLost.includes("ai.use")) violations.push("AI platform access lost");
  if (platformLost.length) {
    violations.push(`platform permissions lost: ${platformLost.join(", ")}`);
  }
  if (platformGained.length) {
    violations.push(`unexpected platform gains: ${platformGained.join(", ")}`);
  }

  return {
    ok: violations.length === 0,
    aiPermissionsUnchanged: aiUnchanged,
    clearanceUnchanged,
    platformPermissionsLost: platformLost,
    platformPermissionsGained: platformGained,
    violations,
  };
}

export function buildApplyConfirmToken(
  authUserId: string,
  employmentType: string,
): string {
  // Deterministic token for human double-check (not a secret — confirmation intent only).
  const payload = `${authUserId}:${employmentType}:staff-backfill`;
  let hash = 0;
  for (let i = 0; i < payload.length; i += 1) {
    hash = (hash * 31 + payload.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0").slice(0, 8);
}
