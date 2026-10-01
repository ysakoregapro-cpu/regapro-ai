import { WeeklyPayDomainError } from "./weekly-pay-errors.js";
import {
  WEEKLY_APPLICATION_STATUSES,
  type WeeklyApplicationStatus,
} from "./weekly-pay-types.js";

const TRANSITIONS: Record<WeeklyApplicationStatus, readonly WeeklyApplicationStatus[]> = {
  draft: ["submitted"],
  submitted: ["returned", "approved"],
  returned: ["submitted"],
  approved: [],
};

export function assertWeeklyPayTransition(
  from: WeeklyApplicationStatus,
  to: WeeklyApplicationStatus,
): void {
  if (!WEEKLY_APPLICATION_STATUSES.includes(from) || !WEEKLY_APPLICATION_STATUSES.includes(to)) {
    throw new WeeklyPayDomainError("INVALID_TRANSITION", `unknown status ${from} -> ${to}`);
  }
  if (!TRANSITIONS[from].includes(to)) {
    throw new WeeklyPayDomainError(
      "INVALID_TRANSITION",
      `invalid status transition: ${from} -> ${to}`,
    );
  }
}

export function assertReturnReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length < 3) {
    throw new WeeklyPayDomainError("INVALID_REASON", "return reason too short");
  }
  if (trimmed.length > 1000) {
    throw new WeeklyPayDomainError("INVALID_REASON", "return reason too long");
  }
  return trimmed;
}

export function assertNotSelfReview(subjectStaffId: string, actorStaffId: string): void {
  if (subjectStaffId === actorStaffId) {
    throw new WeeklyPayDomainError("SELF_REVIEW", "cannot review own weekly application");
  }
}
