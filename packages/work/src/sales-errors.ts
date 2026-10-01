export const SALES_ERROR_CODES = [
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "INVALID_TRANSITION",
  "INVALID_REASON",
  "INVALID_ALLOCATION",
  "NO_APPROVED_RULE",
] as const;

export type SalesErrorCode = (typeof SALES_ERROR_CODES)[number];

export class SalesDomainError extends Error {
  readonly code: SalesErrorCode;

  constructor(code: SalesErrorCode, message: string) {
    super(message);
    this.name = "SalesDomainError";
    this.code = code;
  }
}

export function isSalesDomainError(err: unknown): err is SalesDomainError {
  return err instanceof SalesDomainError;
}
