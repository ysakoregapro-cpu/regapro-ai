export const PERSONAL_SALES_CASE_STATUSES = ["active", "voided", "corrected"] as const;
export type PersonalSalesCaseStatus = (typeof PERSONAL_SALES_CASE_STATUSES)[number];

export const ALLOCATION_RULE_STATUSES = ["draft", "approved", "revoked"] as const;
export type AllocationRuleStatus = (typeof ALLOCATION_RULE_STATUSES)[number];

export type PersonalSalesAllocation = {
  id: string;
  caseId: string;
  orgId: string;
  staffId: string;
  allocationType: string | null;
  shareRateBps: number;
  amountYen: number;
  allocatedProfitInclYen: number | null;
  allocationRuleVersionId: string | null;
  createdAt: string;
};

export type PersonalSalesCase = {
  id: string;
  orgId: string;
  staffId: string | null;
  occurredOn: string;
  title: string;
  totalAmountYen: number;
  caseProfitInclYen: number | null;
  status: PersonalSalesCaseStatus;
  note: string | null;
  sourceRef: unknown;
  correctedCaseId: string | null;
  createdByStaffId: string;
  createdAt: string;
  updatedAt: string;
  allocations: PersonalSalesAllocation[];
};

export type PersonalSalesAllocationRuleVersion = {
  id: string;
  orgId: string;
  version: number;
  status: AllocationRuleStatus;
  effectiveFrom: string;
  effectiveTo: string | null;
  rulePayload: unknown;
  createdByStaffId: string;
  approvedByStaffId: string | null;
  approvedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type PersonalSalesCaseListQuery = {
  from?: string;
  to?: string;
  staffId?: string;
  status?: PersonalSalesCaseStatus;
};

export type CreatePersonalSalesCaseInput = {
  staffId?: string;
  occurredOn: string;
  title: string;
  totalAmountYen: number;
  note?: string | null;
  allocations: Array<{ staffId: string; shareRateBps: number; amountYen: number }>;
  allocationRuleVersionId?: string | null;
};

export type CorrectPersonalSalesCaseInput = {
  caseId: string;
  occurredOn: string;
  title: string;
  totalAmountYen: number;
  note?: string | null;
  allocations: Array<{ staffId: string; shareRateBps: number; amountYen: number }>;
  reason: string;
};

export type UpsertAllocationRuleDraftInput = {
  effectiveFrom: string;
  effectiveTo?: string | null;
  rulePayload: unknown;
};
