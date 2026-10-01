export const EXPENSE_ERROR_CODES = [
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "INVALID_TRANSITION",
  "INVALID_REASON",
  "SELF_REVIEW",
  "INVALID_AMOUNT",
] as const;

export type ExpenseErrorCode = (typeof EXPENSE_ERROR_CODES)[number];

export class ExpenseDomainError extends Error {
  readonly code: ExpenseErrorCode;

  constructor(code: ExpenseErrorCode, message: string) {
    super(message);
    this.name = "ExpenseDomainError";
    this.code = code;
  }
}

export function isExpenseDomainError(err: unknown): err is ExpenseDomainError {
  return err instanceof ExpenseDomainError;
}
