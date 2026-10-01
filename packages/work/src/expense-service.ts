import type { PlatformPermission } from "@regapro/shared";
import { ExpenseDomainError } from "./expense-errors.js";
import {
  assertExpenseAmount,
  assertExpenseReturnReason,
  assertNotSelfExpenseReview,
} from "./expense-lifecycle.js";
import type { ExpensePorts } from "./expense-ports.js";
import type {
  AttachExpenseReceiptInput,
  ExpenseApplication,
  ExpenseApplicationListQuery,
  ExpenseCategory,
  UpsertExpenseApplicationDraftInput,
} from "./expense-types.js";

export type ExpenseActor = {
  staffId: string;
  orgId: string;
  permissions: readonly PlatformPermission[];
};

function has(actor: ExpenseActor, permission: PlatformPermission): boolean {
  return actor.permissions.includes(permission);
}

function requireStaff(actor: ExpenseActor): void {
  if (!actor.staffId) {
    throw new ExpenseDomainError("FORBIDDEN", "staff identity is required");
  }
}

export function canSubmitExpense(actor: ExpenseActor): boolean {
  return has(actor, "expense.submit") || has(actor, "expense.manage");
}

export function canViewOwnExpense(actor: ExpenseActor): boolean {
  return (
    has(actor, "expense.view_own") || canSubmitExpense(actor) || has(actor, "expense.manage")
  );
}

export function canManageExpense(actor: ExpenseActor): boolean {
  return has(actor, "expense.manage");
}

export async function listExpenseCategories(
  ports: ExpensePorts,
  actor: ExpenseActor,
): Promise<ExpenseCategory[]> {
  requireStaff(actor);
  if (!canViewOwnExpense(actor)) {
    throw new ExpenseDomainError("FORBIDDEN", "expense.view_own required");
  }
  return ports.categories.list(actor.orgId);
}

export async function listExpenseApplications(
  ports: ExpensePorts,
  actor: ExpenseActor,
  query: ExpenseApplicationListQuery,
): Promise<ExpenseApplication[]> {
  requireStaff(actor);
  if (!canViewOwnExpense(actor)) {
    throw new ExpenseDomainError("FORBIDDEN", "expense.view_own required");
  }
  if (canManageExpense(actor)) {
    return ports.applications.list(actor.orgId, query);
  }
  return ports.applications.list(actor.orgId, { ...query, staffId: actor.staffId });
}

export async function getExpenseApplication(
  ports: ExpensePorts,
  actor: ExpenseActor,
  applicationId: string,
): Promise<ExpenseApplication> {
  requireStaff(actor);
  if (!canViewOwnExpense(actor)) {
    throw new ExpenseDomainError("FORBIDDEN", "expense.view_own required");
  }
  const app = await ports.applications.getById(actor.orgId, applicationId);
  if (!app) {
    throw new ExpenseDomainError("NOT_FOUND", "expense application");
  }
  if (app.staffId !== actor.staffId && !canManageExpense(actor)) {
    throw new ExpenseDomainError("FORBIDDEN", "cannot read another staff expense application");
  }
  return app;
}

export async function upsertExpenseApplicationDraft(
  ports: ExpensePorts,
  actor: ExpenseActor,
  input: UpsertExpenseApplicationDraftInput,
): Promise<ExpenseApplication> {
  requireStaff(actor);
  if (!canSubmitExpense(actor)) {
    throw new ExpenseDomainError("FORBIDDEN", "expense.submit required");
  }
  const target = input.staffId ?? actor.staffId;
  if (target !== actor.staffId && !canManageExpense(actor)) {
    throw new ExpenseDomainError("FORBIDDEN", "cannot create expense for another staff");
  }
  assertExpenseAmount(input.amountYen);
  const desc = input.description.trim();
  if (desc.length < 1 || desc.length > 4000) {
    throw new ExpenseDomainError("INVALID_REASON", "description length invalid");
  }
  return ports.applications.upsertDraft(actor.orgId, { ...input, staffId: target });
}

export async function submitExpenseApplication(
  ports: ExpensePorts,
  actor: ExpenseActor,
  applicationId: string,
): Promise<ExpenseApplication> {
  requireStaff(actor);
  if (!canSubmitExpense(actor)) {
    throw new ExpenseDomainError("FORBIDDEN", "expense.submit required");
  }
  const existing = await ports.applications.getById(actor.orgId, applicationId);
  if (!existing) {
    throw new ExpenseDomainError("NOT_FOUND", "expense application");
  }
  if (existing.staffId !== actor.staffId && !canManageExpense(actor)) {
    throw new ExpenseDomainError("FORBIDDEN", "cannot submit another staff application");
  }
  return ports.applications.submit(actor.orgId, applicationId);
}

export async function returnExpenseApplication(
  ports: ExpensePorts,
  actor: ExpenseActor,
  applicationId: string,
  reason: string,
): Promise<ExpenseApplication> {
  requireStaff(actor);
  if (!canManageExpense(actor)) {
    throw new ExpenseDomainError("FORBIDDEN", "expense.manage required");
  }
  const existing = await ports.applications.getById(actor.orgId, applicationId);
  if (!existing) {
    throw new ExpenseDomainError("NOT_FOUND", "expense application");
  }
  assertNotSelfExpenseReview(existing.staffId, actor.staffId);
  return ports.applications.return(
    actor.orgId,
    applicationId,
    assertExpenseReturnReason(reason),
  );
}

export async function approveExpenseApplication(
  ports: ExpensePorts,
  actor: ExpenseActor,
  applicationId: string,
): Promise<ExpenseApplication> {
  requireStaff(actor);
  if (!canManageExpense(actor)) {
    throw new ExpenseDomainError("FORBIDDEN", "expense.manage required");
  }
  const existing = await ports.applications.getById(actor.orgId, applicationId);
  if (!existing) {
    throw new ExpenseDomainError("NOT_FOUND", "expense application");
  }
  assertNotSelfExpenseReview(existing.staffId, actor.staffId);
  return ports.applications.approve(actor.orgId, applicationId);
}

export async function attachExpenseReceipt(
  ports: ExpensePorts,
  actor: ExpenseActor,
  input: AttachExpenseReceiptInput,
): Promise<ExpenseApplication> {
  requireStaff(actor);
  if (!canSubmitExpense(actor)) {
    throw new ExpenseDomainError("FORBIDDEN", "expense.submit required");
  }
  const existing = await ports.applications.getById(actor.orgId, input.applicationId);
  if (!existing) {
    throw new ExpenseDomainError("NOT_FOUND", "expense application");
  }
  if (existing.staffId !== actor.staffId && !canManageExpense(actor)) {
    throw new ExpenseDomainError("FORBIDDEN", "cannot attach receipt for another staff");
  }
  if (existing.status === "approved") {
    throw new ExpenseDomainError("INVALID_TRANSITION", "approved application is immutable");
  }
  return ports.applications.attachReceipt(actor.orgId, input);
}
