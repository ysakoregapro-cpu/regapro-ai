/**
 * Weekly Pay domain errors. Distinct from Work Record / Shift failures.
 */

export const WEEKLY_PAY_ERROR_CODES = [
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "INVALID_TRANSITION",
  "INVALID_REASON",
  "INVALID_SELECTION",
  "WEEK_CUTOFF",
  "NO_POLICY",
  "NO_WAGE",
  "SELF_REVIEW",
  "DUPLICATE_WEEK",
  "ALREADY_APPLIED",
  "CROSS_WEEK",
  "FUTURE_WORK_DATE",
  "ZERO_AMOUNT",
  "NO_BANK",
  "INVALID_BANK",
  "BANK_KEY_MISSING",
  "INVALID_TRANSFEROR",
  "TRANSFEROR_UNSET",
  "INVALID_TRANSFER_DATE",
  "DUPLICATE_BATCH",
  "ALREADY_PAID",
  "TOTAL_MISMATCH",
] as const;

export type WeeklyPayErrorCode = (typeof WEEKLY_PAY_ERROR_CODES)[number];

export class WeeklyPayDomainError extends Error {
  readonly code: WeeklyPayErrorCode;

  constructor(code: WeeklyPayErrorCode, message: string) {
    super(message);
    this.name = "WeeklyPayDomainError";
    this.code = code;
  }
}

export function isWeeklyPayDomainError(err: unknown): err is WeeklyPayDomainError {
  return err instanceof WeeklyPayDomainError;
}

export function weeklyPayRpcMessage(code: WeeklyPayErrorCode, detail: string): string {
  return `WEEKLY_PAY_${code}: ${detail}`;
}
