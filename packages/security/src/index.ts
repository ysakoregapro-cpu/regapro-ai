import type {
  ConfidentialityLevel,
  DepartmentKey,
  EmploymentType,
  Permission,
  PermissionGrant,
  PermissionScope,
  Role,
  StaffRef,
  StaffStatus,
  Visibility,
} from "@regapro/shared";
import {
  ROLE_PERMISSIONS,
  compareConfidentiality,
  confidentialityRank,
  isConfidentialityAtMost,
  minConfidentiality,
  resolveEffectiveClearance,
  inheritSecurityLabel,
  scopesEqual,
  type SecurityLabel,
} from "@regapro/shared";

export interface PermissionContext {
  roles: Role[];
  extraPermissions?: Permission[];
}

export function hasPermission(
  ctx: PermissionContext,
  permission: Permission,
): boolean {
  if (ctx.extraPermissions?.includes(permission)) return true;
  return ctx.roles.some((role) => ROLE_PERMISSIONS[role].includes(permission));
}

export function listEffectivePermissions(ctx: PermissionContext): Permission[] {
  const set = new Set<Permission>(ctx.extraPermissions ?? []);
  for (const role of ctx.roles) {
    for (const p of ROLE_PERMISSIONS[role]) set.add(p);
  }
  return [...set];
}

export interface VisibilityContext {
  visibility: Visibility;
  userId: string;
  ownerId: string;
  participantIds?: string[];
  departmentMemberIds?: string[];
  projectMemberIds?: string[];
  organizationMemberIds?: string[];
  /** Explicit restricted allow-list */
  restrictedUserIds?: string[];
}

export function canAccessByVisibility(ctx: VisibilityContext): boolean {
  switch (ctx.visibility) {
    case "private":
      return ctx.userId === ctx.ownerId;
    case "participants":
      return (
        ctx.userId === ctx.ownerId ||
        (ctx.participantIds?.includes(ctx.userId) ?? false)
      );
    case "department":
      return (
        ctx.userId === ctx.ownerId ||
        (ctx.departmentMemberIds?.includes(ctx.userId) ?? false)
      );
    case "project":
      return (
        ctx.userId === ctx.ownerId ||
        (ctx.projectMemberIds?.includes(ctx.userId) ?? false)
      );
    case "organization":
      return (
        ctx.userId === ctx.ownerId ||
        (ctx.organizationMemberIds?.includes(ctx.userId) ?? false)
      );
    case "restricted":
      return (
        ctx.userId === ctx.ownerId ||
        (ctx.restrictedUserIds?.includes(ctx.userId) ?? false)
      );
    default:
      return false;
  }
}

/**
 * Staff facts attached to an access context.
 *
 * Present only once the caller's `auth.users.id` has been mapped to a
 * `staff.staff_id` through `staff_identities`. Until backfill completes these
 * stay empty and callers run in *compatibility mode* — see
 * `docs/architecture/staff-identity.md`.
 */
export interface StaffAccessFields {
  /** Login identity. Mirrors `userId`; kept explicit so the two never blur. */
  authUserId: string;
  /** Canonical person identity. `null` until the caller is linked to staff. */
  staffId: string | null;
  staffNo: string | null;
  /** Contractual relationship only — never a permission input. */
  employmentType: EmploymentType | null;
  staffStatus: StaffStatus | null;
  /** All departments the staff belongs to (`departmentId` stays the primary one). */
  departmentIds: string[];
  /** Platform role ids from `staff_role_assignments`. */
  roleIds: string[];
  /** Feature Permission axis. Distinct from `permissionKeys`. */
  permissions: PermissionGrant[];
  /** Distinct scopes the caller holds any grant in. */
  scopes: PermissionScope[];
}

export interface AccessContext extends Partial<StaffAccessFields> {
  userId: string;
  organizationId: string;
  membershipId: string;
  departmentId: string | null;
  departmentKey: DepartmentKey;
  roleKeys: Role[];
  /**
   * Legacy AI-runtime capability keys (colon notation, e.g. `chat:use`).
   * Governs the existing AI surfaces. NOT the integrated-app feature axis —
   * use `permissions` for that.
   */
  permissionKeys: Permission[];
  maximumConfidentialityLevel: ConfidentialityLevel;
  threadConfidentialityLevel: ConfidentialityLevel;
  threadVisibility: Visibility;
  projectIds: string[];
  participantThreadIds: string[];
  auditMode: boolean;
  auditCaseId: string | null;
}

/** Normalises the optional staff fields so callers never branch on `undefined`. */
export function staffFieldsOf(ctx: AccessContext): StaffAccessFields {
  return {
    authUserId: ctx.authUserId ?? ctx.userId,
    staffId: ctx.staffId ?? null,
    staffNo: ctx.staffNo ?? null,
    employmentType: ctx.employmentType ?? null,
    staffStatus: ctx.staffStatus ?? null,
    departmentIds:
      ctx.departmentIds ?? (ctx.departmentId ? [ctx.departmentId] : []),
    roleIds: ctx.roleIds ?? [],
    permissions: ctx.permissions ?? [],
    scopes: ctx.scopes ?? [],
  };
}

/** True while the caller has no linked staff record and legacy fallbacks apply. */
export function isStaffCompatibilityMode(ctx: AccessContext): boolean {
  return (ctx.staffId ?? null) === null;
}

export function distinctScopes(grants: PermissionGrant[]): PermissionScope[] {
  const out: PermissionScope[] = [];
  for (const grant of grants) {
    if (!out.some((s) => scopesEqual(s, grant.scope))) out.push(grant.scope);
  }
  return out;
}

export function effectiveSearchCeiling(ctx: AccessContext): ConfidentialityLevel {
  return minConfidentiality(
    ctx.maximumConfidentialityLevel,
    ctx.threadConfidentialityLevel,
  );
}

export function buildAccessContext(input: {
  userId: string;
  organizationId: string;
  membershipId: string;
  departmentId: string | null;
  departmentKey: DepartmentKey;
  roles: Role[];
  clearanceOverride?: ConfidentialityLevel | null;
  threadConfidentialityLevel?: ConfidentialityLevel;
  threadVisibility?: Visibility;
  projectIds?: string[];
  participantThreadIds?: string[];
  auditMode?: boolean;
  auditCaseId?: string | null;
  extraPermissions?: Permission[];
  /** Optional. Omit during Phase 1–2 to keep the legacy behaviour unchanged. */
  staff?: StaffRef | null;
  authUserId?: string;
  departmentIds?: string[];
  roleIds?: string[];
  permissions?: PermissionGrant[];
}): AccessContext {
  const permissionKeys = listEffectivePermissions({
    roles: input.roles,
    extraPermissions: input.extraPermissions,
  });
  const grants = input.permissions ?? [];
  return {
    userId: input.userId,
    authUserId: input.authUserId ?? input.userId,
    staffId: input.staff?.staffId ?? null,
    staffNo: input.staff?.staffNo ?? null,
    employmentType: input.staff?.employmentType ?? null,
    staffStatus: input.staff?.status ?? null,
    departmentIds:
      input.departmentIds ?? (input.departmentId ? [input.departmentId] : []),
    roleIds: input.roleIds ?? [],
    permissions: grants,
    scopes: distinctScopes(grants),
    organizationId: input.organizationId,
    membershipId: input.membershipId,
    departmentId: input.departmentId,
    departmentKey: input.departmentKey,
    roleKeys: input.roles,
    permissionKeys,
    maximumConfidentialityLevel: resolveEffectiveClearance({
      departmentKey: input.departmentKey,
      clearanceOverride: input.clearanceOverride,
    }),
    threadConfidentialityLevel: input.threadConfidentialityLevel ?? "company",
    threadVisibility: input.threadVisibility ?? "private",
    projectIds: input.projectIds ?? [],
    participantThreadIds: input.participantThreadIds ?? [],
    auditMode: input.auditMode === true,
    auditCaseId: input.auditCaseId ?? null,
  };
}

export function canAssignConfidentialityLevel(
  ctx: AccessContext,
  requested: ConfidentialityLevel,
): boolean {
  return isConfidentialityAtMost(requested, ctx.maximumConfidentialityLevel);
}

export function canAccessConfidentialityLevel(
  ctx: AccessContext,
  resourceLevel: ConfidentialityLevel,
): boolean {
  const ceiling = effectiveSearchCeiling(ctx);
  return isConfidentialityAtMost(resourceLevel, ceiling);
}

export function canReadPrivateThread(
  ctx: AccessContext,
  thread: { ownerUserId: string; visibility: Visibility; id: string },
): boolean {
  if (thread.visibility !== "private") {
    return canAccessByVisibility({
      visibility: thread.visibility,
      userId: ctx.userId,
      ownerId: thread.ownerUserId,
      participantIds: ctx.participantThreadIds.includes(thread.id)
        ? [ctx.userId]
        : [],
      projectMemberIds: ctx.projectIds,
      organizationMemberIds: [ctx.userId],
    });
  }
  if (thread.ownerUserId === ctx.userId) return true;
  if (ctx.participantThreadIds.includes(thread.id)) return true;
  if (
    ctx.auditMode &&
    ctx.auditCaseId &&
    hasPermission(
      { roles: ctx.roleKeys, extraPermissions: ctx.permissionKeys },
      "conversation:audit",
    )
  ) {
    return true;
  }
  return false;
}

export function filterResourcesByAccess<
  T extends {
    confidentialityLevel: ConfidentialityLevel;
    visibility: Visibility;
    ownerUserId?: string;
    id?: string;
  },
>(ctx: AccessContext, resources: T[]): T[] {
  return resources.filter((r) => {
    if (!canAccessConfidentialityLevel(ctx, r.confidentialityLevel)) return false;
    if (r.visibility === "private") {
      return canReadPrivateThread(ctx, {
        ownerUserId: r.ownerUserId ?? "",
        visibility: r.visibility,
        id: r.id ?? "",
      });
    }
    return canAccessByVisibility({
      visibility: r.visibility,
      userId: ctx.userId,
      ownerId: r.ownerUserId ?? "",
      participantIds: r.id && ctx.participantThreadIds.includes(r.id)
        ? [ctx.userId]
        : [],
      projectMemberIds: ctx.projectIds,
      organizationMemberIds: [ctx.userId],
    });
  });
}

export type SensitiveResourceKind =
  | "message"
  | "citation"
  | "knowledge"
  | "attachment"
  | "artifact"
  | "task"
  | "research";

export function canLowerResourceLevel(input: {
  currentLevel: ConfidentialityLevel;
  newLevel: ConfidentialityLevel;
  derivedMinimum?: ConfidentialityLevel;
  childLevels: ConfidentialityLevel[];
}): { allowed: boolean; blockingLevels: ConfidentialityLevel[]; advice: string } {
  if (compareConfidentiality(input.newLevel, input.currentLevel) >= 0) {
    return { allowed: true, blockingLevels: [], advice: "" };
  }
  const blockers = [
    ...(input.derivedMinimum ? [input.derivedMinimum] : []),
    ...input.childLevels,
  ].filter((l) => confidentialityRank(l) > confidentialityRank(input.newLevel));

  if (blockers.length === 0) {
    return { allowed: true, blockingLevels: [], advice: "" };
  }

  return {
    allowed: false,
    blockingLevels: blockers,
    advice:
      "このスレッドには、より高い情報区分の内容が含まれています。公開可能な内容だけを抽出した新しいスレッドを作成してください。",
  };
}

export function createInheritedChildLabel(
  parent: SecurityLabel,
  origin: { threadId?: string | null; messageId?: string | null },
): SecurityLabel {
  return inheritSecurityLabel(parent, {
    originThreadId: origin.threadId,
    originMessageId: origin.messageId,
  });
}

export type ClassificationSignal =
  | "applicant"
  | "resume"
  | "interview"
  | "employee_hr"
  | "leave"
  | "compensation"
  | "evaluation"
  | "funding"
  | "board"
  | "acquisition"
  | "strategy"
  | "market_salary"
  | "general_formula"
  | "recruiting_howto";

export interface ClassificationResult {
  suggestedLevel: ConfidentialityLevel;
  confidence: number;
  matchedSignals: ClassificationSignal[];
  reason: string;
  requiresConfirmation: boolean;
  requiresPermission: boolean;
}

const PEOPLE_PATTERNS: { signal: ClassificationSignal; re: RegExp }[] = [
  { signal: "applicant", re: /応募者|候補者|求職者/ },
  { signal: "resume", re: /履歴書|職務経歴書|CV/i },
  { signal: "interview", re: /面接評価|面接フィードバック/ },
  { signal: "employee_hr", re: /社員情報|人事施策|休職|勤怠上の/ },
  { signal: "leave", re: /休職|産休|育休/ },
];

const EXEC_PATTERNS: { signal: ClassificationSignal; re: RegExp }[] = [
  { signal: "compensation", re: /実給与|実際の給与|賞与|給与明細|個人別の報酬|報酬額/ },
  { signal: "evaluation", re: /人事評価|未公開評価|降給|昇給決定/ },
  { signal: "funding", re: /資金調達|利益計画|資金繰り/ },
  { signal: "board", re: /経営会議|役員会/ },
  { signal: "acquisition", re: /買収|出資|株式譲渡/ },
  { signal: "strategy", re: /未公開事業戦略|懲戒/ },
];

const COMPANY_SAFE: { signal: ClassificationSignal; re: RegExp }[] = [
  { signal: "market_salary", re: /平均給与|市場給与|相場|Webで調べ/ },
  { signal: "general_formula", re: /給与計算の一般|計算式|一般的な式/ },
  { signal: "recruiting_howto", re: /採用ノウハウ|求人票の作り方|面接の進め方/ },
];

/**
 * Rule-based classifier. Never writes secrets to logs.
 * Context-aware: market salary stays company; real employee pay needs executive.
 */
export function classifySensitiveContent(text: string): ClassificationResult {
  const matched: ClassificationSignal[] = [];
  let suggested: ConfidentialityLevel = "company";
  let confidence = 0.4;
  let requiresPermission = false;

  for (const p of COMPANY_SAFE) {
    if (p.re.test(text)) {
      matched.push(p.signal);
      confidence = Math.max(confidence, 0.7);
    }
  }

  const marketOnly =
    matched.includes("market_salary") ||
    matched.includes("general_formula") ||
    matched.includes("recruiting_howto");

  for (const p of PEOPLE_PATTERNS) {
    if (p.re.test(text)) {
      matched.push(p.signal);
      suggested = "people";
      confidence = Math.max(confidence, 0.78);
    }
  }

  for (const p of EXEC_PATTERNS) {
    if (p.re.test(text)) {
      matched.push(p.signal);
      suggested = "executive";
      confidence = Math.max(confidence, 0.88);
      requiresPermission = true;
    }
  }

  // 「〇〇さんの実給与」等
  if (/さん.?の.*(給与|賞与|評価)/.test(text) || /実給与/.test(text)) {
    if (!matched.includes("market_salary")) {
      suggested = "executive";
      matched.push("compensation");
      confidence = Math.max(confidence, 0.92);
      requiresPermission = true;
    }
  }

  if (marketOnly && suggested === "company") {
    return {
      suggestedLevel: "company",
      confidence,
      matchedSignals: matched,
      reason: "一般公開可能な市場・計算・ノウハウに関する依頼です",
      requiresConfirmation: false,
      requiresPermission: false,
    };
  }

  if (suggested === "executive") {
    return {
      suggestedLevel: "executive",
      confidence,
      matchedSignals: matched,
      reason: "給与・評価等の経営情報を含む可能性があります",
      requiresConfirmation: true,
      requiresPermission,
    };
  }

  if (suggested === "people") {
    return {
      suggestedLevel: "people",
      confidence,
      matchedSignals: matched,
      reason: "人事情報を含む可能性があります",
      requiresConfirmation: true,
      requiresPermission: false,
    };
  }

  return {
    suggestedLevel: "company",
    confidence: matched.length ? confidence : 0.55,
    matchedSignals: matched,
    reason: "一般業務として扱えます",
    requiresConfirmation: false,
    requiresPermission: false,
  };
}

/** Assembles only sources already filtered by AccessContext / RLS. */
export function buildLlmContextSources<
  T extends {
    id: string;
    confidentialityLevel: ConfidentialityLevel;
    visibility: Visibility;
    text: string;
  },
>(
  ctx: AccessContext,
  sources: T[],
): { allowed: T[]; rejectedIds: string[] } {
  const ceiling = effectiveSearchCeiling(ctx);
  const allowed: T[] = [];
  const rejectedIds: string[] = [];
  for (const s of sources) {
    if (!isConfidentialityAtMost(s.confidentialityLevel, ceiling)) {
      rejectedIds.push(s.id);
      continue;
    }
    if (s.visibility === "private" && !canReadPrivateThread(ctx, {
      id: s.id,
      ownerUserId: ctx.userId, // caller must pre-filter private of others
      visibility: s.visibility,
    }) && !ctx.participantThreadIds.includes(s.id)) {
      // Private of others already excluded by repository; belt-and-suspenders.
      rejectedIds.push(s.id);
      continue;
    }
    allowed.push(s);
  }
  return { allowed, rejectedIds };
}

const FORBIDDEN_PATH = /\.\.|\/\\|^\/|^\\|:|\0/;

export function isSafeStoragePath(path: string): boolean {
  if (!path || path.length > 1024) return false;
  if (FORBIDDEN_PATH.test(path)) return false;
  const segments = path.split("/").filter(Boolean);
  return segments.every((s) => s !== "." && s !== "..");
}

export function normalizeStoragePath(path: string): string {
  if (!isSafeStoragePath(path)) {
    throw new Error("Unsafe storage path");
  }
  return path.split("/").filter(Boolean).join("/");
}

export function rlsDocMembershipCheck(
  userId: string | null,
  memberUserIds: string[],
): boolean {
  return userId !== null && memberUserIds.includes(userId);
}

export function rlsDocOrgScopedAccess(
  rowOrgId: string,
  userOrgIds: string[],
): boolean {
  return userOrgIds.includes(rowOrgId);
}
