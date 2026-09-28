/**
 * Work Record / Employment Term domain errors.
 * Never treat these as Shift or Weekly Pay failures.
 */

export const WORK_ERROR_CODES = [
  "INVALID_TERM_RANGE",
  "TERM_OVERLAP",
  "INVALID_WAGE",
  "INVALID_SCHEDULE",
  "INVALID_BREAK",
  "INVALID_TRANSPORT",
  "FUTURE_CONFIRM",
  "INVALID_TRANSITION",
  "RECORD_IMMUTABLE",
  "LOCKED_IMMUTABLE",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "INVALID_EXTERNAL_REF",
  "INVALID_REASON",
] as const;

export type WorkErrorCode = (typeof WORK_ERROR_CODES)[number];

export class WorkDomainError extends Error {
  readonly code: WorkErrorCode;

  constructor(code: WorkErrorCode, message: string) {
    super(message);
    this.name = "WorkDomainError";
    this.code = code;
  }
}

export function isWorkDomainError(err: unknown): err is WorkDomainError {
  return err instanceof WorkDomainError;
}

/** Prefix used by SECURITY DEFINER RPCs so HTTP mapping stays deterministic. */
export function workRpcMessage(code: WorkErrorCode, detail: string): string {
  return `WORK_${code}: ${detail}`;
}
