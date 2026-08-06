import { z } from "zod";

/** Ranked confidentiality levels (1–3). Never show "Level N" as primary UI copy. */
export const CONFIDENTIALITY_LEVELS = ["company", "people", "executive"] as const;
export type ConfidentialityLevel = (typeof CONFIDENTIALITY_LEVELS)[number];

export const ConfidentialityLevelSchema = z.enum(CONFIDENTIALITY_LEVELS);

export const CONFIDENTIALITY_RANK: Record<ConfidentialityLevel, 1 | 2 | 3> = {
  company: 1,
  people: 2,
  executive: 3,
};

export const CONFIDENTIALITY_LABELS: Record<ConfidentialityLevel, string> = {
  company: "全社",
  people: "人事・管理",
  executive: "経営戦略",
};

export const CONFIDENTIALITY_HINTS: Record<ConfidentialityLevel, string> = {
  company: "一般業務として扱います",
  people: "採用、応募者、社員管理などの情報を扱います",
  executive: "給与、賞与、評価、資金、経営判断などの情報を扱います",
};

export function confidentialityRank(level: ConfidentialityLevel): 1 | 2 | 3 {
  return CONFIDENTIALITY_RANK[level];
}

export function compareConfidentiality(
  a: ConfidentialityLevel,
  b: ConfidentialityLevel,
): number {
  return confidentialityRank(a) - confidentialityRank(b);
}

export function isConfidentialityAtMost(
  value: ConfidentialityLevel,
  max: ConfidentialityLevel,
): boolean {
  return confidentialityRank(value) <= confidentialityRank(max);
}

export function maxConfidentiality(
  a: ConfidentialityLevel,
  b: ConfidentialityLevel,
): ConfidentialityLevel {
  return compareConfidentiality(a, b) >= 0 ? a : b;
}

export function minConfidentiality(
  a: ConfidentialityLevel,
  b: ConfidentialityLevel,
): ConfidentialityLevel {
  return compareConfidentiality(a, b) <= 0 ? a : b;
}

export function confidentialityFromRank(rank: number): ConfidentialityLevel {
  if (rank <= 1) return "company";
  if (rank === 2) return "people";
  return "executive";
}

export const DEPARTMENT_KEYS = ["sales", "people", "executive_strategy"] as const;
export type DepartmentKey = (typeof DEPARTMENT_KEYS)[number];

export const DepartmentKeySchema = z.enum(DEPARTMENT_KEYS);

export const DEPARTMENT_LABELS: Record<DepartmentKey, string> = {
  sales: "営業部",
  people: "人事部",
  executive_strategy: "経営戦略部",
};

/** Default maximum clearance by department when membership has no override. */
export const DEPARTMENT_DEFAULT_CLEARANCE: Record<
  DepartmentKey,
  ConfidentialityLevel
> = {
  sales: "company",
  people: "people",
  executive_strategy: "executive",
};

export function selectableLevelsForClearance(
  max: ConfidentialityLevel,
): ConfidentialityLevel[] {
  return CONFIDENTIALITY_LEVELS.filter((l) => isConfidentialityAtMost(l, max));
}

export function resolveEffectiveClearance(input: {
  departmentKey: DepartmentKey;
  clearanceOverride?: ConfidentialityLevel | null;
}): ConfidentialityLevel {
  if (input.clearanceOverride) {
    ConfidentialityLevelSchema.parse(input.clearanceOverride);
    return input.clearanceOverride;
  }
  return DEPARTMENT_DEFAULT_CLEARANCE[input.departmentKey];
}
