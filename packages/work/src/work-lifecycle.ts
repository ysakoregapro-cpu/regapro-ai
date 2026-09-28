import { WorkDomainError } from "./work-errors.js";
import type { WorkRecord, WorkRecordStatus } from "./work-types.js";

/**
 * Actual hours lifecycle. locked is reserved for Phase 4 Weekly Pay.
 *
 *   draft -> confirmed -> locked
 *   draft -> voided
 *   confirmed -> draft   (manager reopen, reason required)
 *   confirmed -> voided  (manager, reason required)
 *   locked / voided are terminal in Phase 3
 */
export const WORK_RECORD_TRANSITIONS: Record<
  WorkRecordStatus,
  readonly WorkRecordStatus[]
> = {
  draft: ["confirmed", "voided"],
  confirmed: ["draft", "voided"],
  locked: [],
  voided: [],
};

export function canTransitionWorkRecord(
  from: WorkRecordStatus,
  to: WorkRecordStatus,
): boolean {
  return WORK_RECORD_TRANSITIONS[from].includes(to);
}

export function isWorkRecordContentMutable(status: WorkRecordStatus): boolean {
  return status === "draft";
}

export function allowsMultipleWorkRecordsSameDay(): boolean {
  return true;
}

export function assertWorkRecordMutable(status: WorkRecordStatus): void {
  if (status === "locked") {
    throw new WorkDomainError("LOCKED_IMMUTABLE", "locked work records cannot be changed");
  }
  if (!isWorkRecordContentMutable(status)) {
    throw new WorkDomainError(
      "RECORD_IMMUTABLE",
      "confirmed and voided work records cannot be edited in place",
    );
  }
}

export function assertReason(reason: string | null | undefined): string {
  const value = reason?.trim() ?? "";
  if (value.length === 0) {
    throw new WorkDomainError("INVALID_REASON", "reason is required");
  }
  return value;
}

export type ConfirmWorkRecordPlan =
  | { kind: "idempotent"; record: WorkRecord }
  | { kind: "confirm"; record: WorkRecord };

export function planConfirmWorkRecord(record: WorkRecord): ConfirmWorkRecordPlan {
  if (record.status === "confirmed") {
    return { kind: "idempotent", record };
  }
  if (record.status === "locked") {
    throw new WorkDomainError("LOCKED_IMMUTABLE", "locked work records cannot be confirmed");
  }
  if (!canTransitionWorkRecord(record.status, "confirmed")) {
    throw new WorkDomainError(
      "INVALID_TRANSITION",
      `cannot confirm a ${record.status} work record`,
    );
  }
  return { kind: "confirm", record };
}

export type ReopenWorkRecordPlan = { kind: "reopen"; record: WorkRecord };

export function planReopenWorkRecord(
  record: WorkRecord,
  reason: string | null | undefined,
): ReopenWorkRecordPlan {
  assertReason(reason);
  if (record.status === "locked") {
    throw new WorkDomainError("LOCKED_IMMUTABLE", "locked work records cannot be reopened");
  }
  if (!canTransitionWorkRecord(record.status, "draft") || record.status !== "confirmed") {
    throw new WorkDomainError(
      "INVALID_TRANSITION",
      `cannot reopen a ${record.status} work record`,
    );
  }
  return { kind: "reopen", record };
}

export type VoidWorkRecordPlan =
  | { kind: "idempotent"; record: WorkRecord }
  | { kind: "void"; record: WorkRecord };

export function planVoidWorkRecord(
  record: WorkRecord,
  reason: string | null | undefined,
): VoidWorkRecordPlan {
  assertReason(reason);
  if (record.status === "voided") {
    return { kind: "idempotent", record };
  }
  if (record.status === "locked") {
    throw new WorkDomainError("LOCKED_IMMUTABLE", "locked work records cannot be voided");
  }
  if (!canTransitionWorkRecord(record.status, "voided")) {
    throw new WorkDomainError(
      "INVALID_TRANSITION",
      `cannot void a ${record.status} work record`,
    );
  }
  return { kind: "void", record };
}
