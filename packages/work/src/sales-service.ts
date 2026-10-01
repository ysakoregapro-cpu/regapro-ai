import type { PlatformPermission } from "@regapro/shared";
import { SalesDomainError } from "./sales-errors.js";
import { assertAllocationSnapshot, assertSalesReason } from "./sales-lifecycle.js";
import type { SalesPorts } from "./sales-ports.js";
import type {
  CorrectPersonalSalesCaseInput,
  CreatePersonalSalesCaseInput,
  PersonalSalesAllocationRuleVersion,
  PersonalSalesCase,
  PersonalSalesCaseListQuery,
  UpsertAllocationRuleDraftInput,
} from "./sales-types.js";

export type SalesActor = {
  staffId: string;
  orgId: string;
  permissions: readonly PlatformPermission[];
};

function has(actor: SalesActor, permission: PlatformPermission): boolean {
  return actor.permissions.includes(permission);
}

function requireStaff(actor: SalesActor): void {
  if (!actor.staffId) {
    throw new SalesDomainError("FORBIDDEN", "staff identity is required");
  }
}

export function canViewOwnSales(actor: SalesActor): boolean {
  return has(actor, "sales.view_own") || has(actor, "sales.manage");
}

export function canManageSales(actor: SalesActor): boolean {
  return has(actor, "sales.manage");
}

export async function listPersonalSalesCases(
  ports: SalesPorts,
  actor: SalesActor,
  query: PersonalSalesCaseListQuery,
): Promise<PersonalSalesCase[]> {
  requireStaff(actor);
  if (!canViewOwnSales(actor)) {
    throw new SalesDomainError("FORBIDDEN", "sales.view_own required");
  }
  if (canManageSales(actor)) {
    return ports.cases.list(actor.orgId, query);
  }
  return ports.cases.list(actor.orgId, { ...query, staffId: actor.staffId });
}

export async function getPersonalSalesCase(
  ports: SalesPorts,
  actor: SalesActor,
  caseId: string,
): Promise<PersonalSalesCase> {
  requireStaff(actor);
  if (!canViewOwnSales(actor)) {
    throw new SalesDomainError("FORBIDDEN", "sales.view_own required");
  }
  const row = await ports.cases.getById(actor.orgId, caseId);
  if (!row) {
    throw new SalesDomainError("NOT_FOUND", "personal sales case");
  }
  const visible =
    canManageSales(actor) ||
    row.staffId === actor.staffId ||
    row.allocations.some((a) => a.staffId === actor.staffId);
  if (!visible) {
    throw new SalesDomainError("FORBIDDEN", "cannot read this sales case");
  }
  return row;
}

export async function createPersonalSalesCase(
  ports: SalesPorts,
  actor: SalesActor,
  input: CreatePersonalSalesCaseInput,
): Promise<PersonalSalesCase> {
  requireStaff(actor);
  if (!canManageSales(actor)) {
    throw new SalesDomainError("FORBIDDEN", "sales.manage required");
  }
  assertAllocationSnapshot(input.totalAmountYen, input.allocations);
  if (input.allocationRuleVersionId) {
    const rules = await ports.rules.list(actor.orgId);
    const rule = rules.find((r) => r.id === input.allocationRuleVersionId);
    if (!rule || rule.status !== "approved") {
      throw new SalesDomainError("NO_APPROVED_RULE", "allocation rule must be approved");
    }
  }
  return ports.cases.create(actor.orgId, input);
}

export async function voidPersonalSalesCase(
  ports: SalesPorts,
  actor: SalesActor,
  caseId: string,
  reason: string,
): Promise<PersonalSalesCase> {
  requireStaff(actor);
  if (!canManageSales(actor)) {
    throw new SalesDomainError("FORBIDDEN", "sales.manage required");
  }
  return ports.cases.voidCase(actor.orgId, caseId, assertSalesReason(reason));
}

export async function correctPersonalSalesCase(
  ports: SalesPorts,
  actor: SalesActor,
  input: CorrectPersonalSalesCaseInput,
): Promise<PersonalSalesCase> {
  requireStaff(actor);
  if (!canManageSales(actor)) {
    throw new SalesDomainError("FORBIDDEN", "sales.manage required");
  }
  assertAllocationSnapshot(input.totalAmountYen, input.allocations);
  assertSalesReason(input.reason);
  return ports.cases.correct(actor.orgId, input);
}

export async function listAllocationRuleVersions(
  ports: SalesPorts,
  actor: SalesActor,
): Promise<PersonalSalesAllocationRuleVersion[]> {
  requireStaff(actor);
  if (!canManageSales(actor)) {
    throw new SalesDomainError("FORBIDDEN", "sales.manage required");
  }
  return ports.rules.list(actor.orgId);
}

export async function upsertAllocationRuleDraft(
  ports: SalesPorts,
  actor: SalesActor,
  input: UpsertAllocationRuleDraftInput,
): Promise<PersonalSalesAllocationRuleVersion> {
  requireStaff(actor);
  if (!canManageSales(actor)) {
    throw new SalesDomainError("FORBIDDEN", "sales.manage required");
  }
  return ports.rules.upsertDraft(actor.orgId, input);
}

export async function approveAllocationRule(
  ports: SalesPorts,
  actor: SalesActor,
  ruleVersionId: string,
): Promise<PersonalSalesAllocationRuleVersion> {
  requireStaff(actor);
  if (!canManageSales(actor)) {
    throw new SalesDomainError("FORBIDDEN", "sales.manage required");
  }
  return ports.rules.approve(actor.orgId, ruleVersionId);
}

export async function revokeAllocationRule(
  ports: SalesPorts,
  actor: SalesActor,
  ruleVersionId: string,
  reason: string,
): Promise<PersonalSalesAllocationRuleVersion> {
  requireStaff(actor);
  if (!canManageSales(actor)) {
    throw new SalesDomainError("FORBIDDEN", "sales.manage required");
  }
  return ports.rules.revoke(actor.orgId, ruleVersionId, assertSalesReason(reason));
}
