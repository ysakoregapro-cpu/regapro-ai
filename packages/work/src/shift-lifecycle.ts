import { ShiftDomainError } from "./errors.js";
import type { Shift, ShiftStatus } from "./types.js";

/**
 * Company-published planned work. Never the source of truth for payroll.
 *
 *   draft -> published
 *   draft | published -> cancelled
 */
export const SHIFT_TRANSITIONS: Record<ShiftStatus, readonly ShiftStatus[]> = {
  draft: ["published", "cancelled"],
  published: ["cancelled"],
  cancelled: [],
};

export function canTransitionShift(from: ShiftStatus, to: ShiftStatus): boolean {
  return SHIFT_TRANSITIONS[from].includes(to);
}

export function isShiftContentMutable(status: ShiftStatus): boolean {
  return status === "draft";
}

export function isShiftVisibleToOwner(status: ShiftStatus): boolean {
  return status === "published";
}

export function allowsMultipleShiftsSameDay(): boolean {
  return true;
}

export type PublishShiftPlan =
  | { kind: "idempotent"; shift: Shift }
  | { kind: "publish"; shift: Shift };

export function planPublishShift(shift: Shift): PublishShiftPlan {
  if (shift.status === "published") {
    return { kind: "idempotent", shift };
  }
  if (!canTransitionShift(shift.status, "published")) {
    throw new ShiftDomainError(
      "INVALID_TRANSITION",
      `cannot publish a ${shift.status} shift`,
    );
  }
  return { kind: "publish", shift };
}

export type CancelShiftPlan =
  | { kind: "idempotent"; shift: Shift }
  | { kind: "cancel"; shift: Shift };

export function planCancelShift(shift: Shift): CancelShiftPlan {
  if (shift.status === "cancelled") {
    return { kind: "idempotent", shift };
  }
  if (!canTransitionShift(shift.status, "cancelled")) {
    throw new ShiftDomainError(
      "INVALID_TRANSITION",
      `cannot cancel a ${shift.status} shift`,
    );
  }
  return { kind: "cancel", shift };
}

export function assertShiftMutable(status: ShiftStatus): void {
  if (!isShiftContentMutable(status)) {
    throw new ShiftDomainError(
      "SHIFT_IMMUTABLE",
      "published and cancelled shifts cannot be edited in place",
    );
  }
}
