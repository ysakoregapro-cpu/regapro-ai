import { ShiftDomainError } from "./errors.js";
import type { ShiftRequest, ShiftRequestStatus } from "./types.js";

/**
 * Shift request is an input to scheduling, not an approval workflow.
 * There is no accepted / rejected status. Final planned work lives on `shifts`.
 *
 *   draft -> submitted -> superseded
 *   draft | submitted -> cancelled
 */
export const REQUEST_TRANSITIONS: Record<
  ShiftRequestStatus,
  readonly ShiftRequestStatus[]
> = {
  draft: ["submitted", "cancelled"],
  submitted: ["superseded", "cancelled"],
  superseded: [],
  cancelled: [],
};

export function canTransitionRequest(
  from: ShiftRequestStatus,
  to: ShiftRequestStatus,
): boolean {
  return REQUEST_TRANSITIONS[from].includes(to);
}

export function isRequestContentMutable(status: ShiftRequestStatus): boolean {
  return status === "draft";
}

export function assertRequestMutable(status: ShiftRequestStatus): void {
  if (!isRequestContentMutable(status)) {
    throw new ShiftDomainError(
      "REQUEST_IMMUTABLE",
      "submitted request dates cannot be changed; submit a new version instead",
    );
  }
}

export type SubmitRequestPlan =
  | { kind: "idempotent"; request: ShiftRequest }
  | {
      kind: "submit";
      request: ShiftRequest;
      supersede: ShiftRequest | null;
    };

export function planSubmitShiftRequest(
  request: ShiftRequest,
  existingSubmitted: ShiftRequest | null,
): SubmitRequestPlan {
  if (request.status === "submitted") {
    return { kind: "idempotent", request };
  }
  if (!canTransitionRequest(request.status, "submitted")) {
    throw new ShiftDomainError(
      "INVALID_TRANSITION",
      `cannot submit a ${request.status} request`,
    );
  }
  if (
    existingSubmitted &&
    existingSubmitted.id !== request.id &&
    (existingSubmitted.staffId !== request.staffId ||
      existingSubmitted.periodStart !== request.periodStart ||
      existingSubmitted.periodEnd !== request.periodEnd)
  ) {
    throw new ShiftDomainError(
      "CONFLICT",
      "existing submitted request is for a different staff or period",
    );
  }
  return {
    kind: "submit",
    request,
    supersede:
      existingSubmitted && existingSubmitted.id !== request.id
        ? existingSubmitted
        : null,
  };
}

export type CancelRequestPlan =
  | { kind: "idempotent"; request: ShiftRequest }
  | { kind: "cancel"; request: ShiftRequest };

/** Transaction advisory-lock identity for one staff period draft. */
export function shiftRequestDraftLockScope(input: {
  orgId: string;
  staffId: string;
  periodStart: string;
  periodEnd: string;
}): string {
  return `${input.orgId}:${input.staffId}:${input.periodStart}:${input.periodEnd}`;
}

export function planCancelShiftRequest(request: ShiftRequest): CancelRequestPlan {
  if (request.status === "cancelled") {
    return { kind: "idempotent", request };
  }
  if (!canTransitionRequest(request.status, "cancelled")) {
    throw new ShiftDomainError(
      "INVALID_TRANSITION",
      `cannot cancel a ${request.status} request`,
    );
  }
  return { kind: "cancel", request };
}
