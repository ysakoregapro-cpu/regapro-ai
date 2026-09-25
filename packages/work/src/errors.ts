/**
 * Shift Domain errors. Codes are stable for HTTP mapping and RPC messages.
 * Never treat these as payroll / Work Record failures — Shift is planned work.
 */

export const SHIFT_ERROR_CODES = [
  "INVALID_PERIOD",
  "DATE_OUT_OF_PERIOD",
  "DUPLICATE_DATE",
  "INVALID_PREFERENCE",
  "ONE_SIDED_TIME",
  "INVALID_OFFSET",
  "INVALID_EXTERNAL_REF",
  "INVALID_PRE_REPORT_URL",
  "INVALID_TRANSITION",
  "REQUEST_IMMUTABLE",
  "SHIFT_IMMUTABLE",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
] as const;

export type ShiftErrorCode = (typeof SHIFT_ERROR_CODES)[number];

export class ShiftDomainError extends Error {
  readonly code: ShiftErrorCode;

  constructor(code: ShiftErrorCode, message: string) {
    super(message);
    this.name = "ShiftDomainError";
    this.code = code;
  }
}

export function isShiftDomainError(err: unknown): err is ShiftDomainError {
  return err instanceof ShiftDomainError;
}

/** Prefix used by SECURITY DEFINER RPCs so HTTP mapping stays deterministic. */
export function shiftRpcMessage(code: ShiftErrorCode, detail: string): string {
  return `SHIFT_${code}: ${detail}`;
}
