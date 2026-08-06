import type {
  ConfidentialityLevel,
  DepartmentKey,
  Permission,
  Role,
} from "@regapro/shared";
import {
  DEPARTMENT_DEFAULT_CLEARANCE,
  DEPARTMENT_LABELS,
  resolveEffectiveClearance,
  selectableLevelsForClearance,
} from "@regapro/shared";
import { buildAccessContext, listEffectivePermissions } from "@regapro/security";

export type SampleMembership = {
  userId: string;
  name: string;
  email: string;
  organizationId: string;
  membershipId: string;
  departmentId: string;
  departmentKey: DepartmentKey;
  departmentLabel: string;
  role: Role;
  clearanceOverride: ConfidentialityLevel | null;
  title: string;
  publicDuties: string;
  publicProjects: string[];
};

export const SAMPLE_DEPARTMENTS = [
  {
    id: "dept-sales",
    key: "sales" as const,
    name: DEPARTMENT_LABELS.sales,
    defaultClearance: DEPARTMENT_DEFAULT_CLEARANCE.sales,
  },
  {
    id: "dept-people",
    key: "people" as const,
    name: DEPARTMENT_LABELS.people,
    defaultClearance: DEPARTMENT_DEFAULT_CLEARANCE.people,
  },
  {
    id: "dept-executive",
    key: "executive_strategy" as const,
    name: DEPARTMENT_LABELS.executive_strategy,
    defaultClearance: DEPARTMENT_DEFAULT_CLEARANCE.executive_strategy,
  },
] as const;

/** Coherent memberships — keys used for access decisions (never trust client). */
export const SAMPLE_MEMBERSHIPS: SampleMembership[] = [
  {
    userId: "user-tanaka",
    name: "田中 健太",
    email: "tanaka@regapro.example",
    organizationId: "org-regapro",
    membershipId: "mem-tanaka",
    departmentId: "dept-sales",
    departmentKey: "sales",
    departmentLabel: "営業部",
    role: "manager",
    clearanceOverride: null,
    title: "有料職業紹介チームリード",
    publicDuties: "求人選定、求職者対応、顧客折衝",
    publicProjects: ["有料職業紹介", "通信イベント運営"],
  },
  {
    userId: "user-morifuji",
    name: "森藤 美穂",
    email: "morifuji@regapro.example",
    organizationId: "org-regapro",
    membershipId: "mem-morifuji",
    departmentId: "dept-sales",
    departmentKey: "sales",
    departmentLabel: "営業部",
    role: "editor",
    clearanceOverride: null,
    title: "キャリアコンサルタント",
    publicDuties: "候補者ヒアリング、求人マッチング",
    publicProjects: ["有料職業紹介"],
  },
  {
    userId: "user-sakawa",
    name: "酒匂 直樹",
    email: "sakawa@regapro.example",
    organizationId: "org-regapro",
    membershipId: "mem-sakawa",
    departmentId: "dept-sales",
    departmentKey: "sales",
    departmentLabel: "営業部",
    role: "member",
    clearanceOverride: null,
    title: "不動産事業担当",
    publicDuties: "物件提案、内見調整、顧客対応",
    publicProjects: ["不動産事業"],
  },
  {
    userId: "user-hr",
    name: "青木 恵",
    email: "aoki@regapro.example",
    organizationId: "org-regapro",
    membershipId: "mem-hr",
    departmentId: "dept-people",
    departmentKey: "people",
    departmentLabel: "人事部",
    role: "editor",
    clearanceOverride: null,
    title: "人事担当",
    publicDuties: "採用オペレーション、制度企画",
    publicProjects: ["採用・人事"],
  },
  {
    userId: "user-exec",
    name: "管理 太郎",
    email: "admin@regapro.example",
    organizationId: "org-regapro",
    membershipId: "mem-exec",
    departmentId: "dept-executive",
    departmentKey: "executive_strategy",
    departmentLabel: "経営戦略部",
    role: "manager",
    clearanceOverride: null,
    title: "経営企画",
    publicDuties: "事業計画、横断プロジェクト推進",
    publicProjects: ["DX開発", "採用・人事"],
  },
  {
    userId: "user-auditor",
    name: "監査 花子",
    email: "auditor@regapro.example",
    organizationId: "org-regapro",
    membershipId: "mem-auditor",
    departmentId: "dept-executive",
    departmentKey: "executive_strategy",
    departmentLabel: "経営戦略部",
    role: "admin",
    clearanceOverride: null,
    title: "内部監査（会話監査権限あり）",
    publicDuties: "内部統制、監査対応",
    publicProjects: [],
  },
];

/** Current UI session user for dev-sample — resolved from membership, not client input. */
export const CURRENT_MEMBERSHIP = SAMPLE_MEMBERSHIPS[0]!;

export function getMembership(userId: string): SampleMembership | null {
  return SAMPLE_MEMBERSHIPS.find((m) => m.userId === userId) ?? null;
}

export function getPublicProfile(userId: string) {
  const m = getMembership(userId);
  if (!m) return null;
  return {
    userId: m.userId,
    name: m.name,
    departmentLabel: m.departmentLabel,
    title: m.title,
    publicDuties: m.publicDuties,
    publicProjects: m.publicProjects,
  };
}

export function resolveSessionAccess(opts?: {
  userId?: string;
  threadLevel?: ConfidentialityLevel;
  threadVisibility?: "private" | "participants" | "project" | "department" | "organization" | "restricted";
  participantThreadIds?: string[];
  auditMode?: boolean;
  auditCaseId?: string | null;
}) {
  const membership = getMembership(opts?.userId ?? CURRENT_MEMBERSHIP.userId);
  if (!membership) {
    throw new Error("MEMBERSHIP_NOT_FOUND");
  }

  const max = resolveEffectiveClearance({
    departmentKey: membership.departmentKey,
    clearanceOverride: membership.clearanceOverride,
  });

  const extra: Permission[] =
    membership.userId === "user-auditor" ? ["conversation:audit", "conversation:audit_manage"] : [];

  const access = buildAccessContext({
    userId: membership.userId,
    organizationId: membership.organizationId,
    membershipId: membership.membershipId,
    departmentId: membership.departmentId,
    departmentKey: membership.departmentKey,
    roles: [membership.role],
    clearanceOverride: membership.clearanceOverride,
    threadConfidentialityLevel: opts?.threadLevel ?? "company",
    threadVisibility: opts?.threadVisibility ?? "private",
    participantThreadIds: opts?.participantThreadIds ?? [],
    auditMode: opts?.auditMode,
    auditCaseId: opts?.auditCaseId,
    extraPermissions: extra,
  });

  return {
    membership,
    access,
    maximumConfidentialityLevel: max,
    selectableLevels: selectableLevelsForClearance(max),
    permissions: listEffectivePermissions({
      roles: [membership.role],
      extraPermissions: extra,
    }),
  };
}
