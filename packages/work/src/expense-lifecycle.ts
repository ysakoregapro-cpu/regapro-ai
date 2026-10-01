import { ExpenseDomainError } from "./expense-errors.js";
import {
  EXPENSE_APPLICATION_STATUSES,
  type ExpenseApplicationStatus,
} from "./expense-types.js";

const TRANSITIONS: Record<ExpenseApplicationStatus, readonly ExpenseApplicationStatus[]> = {
  draft: ["pending"],
  pending: ["returned", "approved"],
  returned: ["pending"],
  approved: [],
};

export function assertExpenseTransition(
  from: ExpenseApplicationStatus,
  to: ExpenseApplicationStatus,
): void {
  if (!EXPENSE_APPLICATION_STATUSES.includes(from) || !EXPENSE_APPLICATION_STATUSES.includes(to)) {
    throw new ExpenseDomainError("INVALID_TRANSITION", `unknown status ${from} -> ${to}`);
  }
  if (!TRANSITIONS[from].includes(to)) {
    throw new ExpenseDomainError(
      "INVALID_TRANSITION",
      `invalid status transition: ${from} -> ${to}`,
    );
  }
}

export function assertExpenseReturnReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length < 3) {
    throw new ExpenseDomainError("INVALID_REASON", "return reason too short");
  }
  if (trimmed.length > 1000) {
    throw new ExpenseDomainError("INVALID_REASON", "return reason too long");
  }
  return trimmed;
}

export function assertNotSelfExpenseReview(subjectStaffId: string, actorStaffId: string): void {
  if (subjectStaffId === actorStaffId) {
    throw new ExpenseDomainError("SELF_REVIEW", "cannot review own expense application");
  }
}

export function assertExpenseAmount(amountYen: number): void {
  if (!Number.isInteger(amountYen) || amountYen <= 0) {
    throw new ExpenseDomainError("INVALID_AMOUNT", "amount must be a positive integer yen");
  }
}
