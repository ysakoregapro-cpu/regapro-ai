import type { PlatformPermission } from "@regapro/shared";
import { ShiftDomainError } from "./errors.js";
import type { ShiftPorts } from "./ports.js";
import type {
  CreateShiftInput,
  CreateShiftRequestDraftInput,
  CreateWorkLocationInput,
  Shift,
  ShiftRequest,
  UpdateShiftDraftInput,
  WorkLocation,
} from "./types.js";
import {
  assertExternalRef,
  assertPreferenceDate,
  assertPreReportUrl,
  assertRequestPeriod,
  assertShiftSchedule,
  assertUniqueDates,
} from "./validation.js";

/**
 * Application-layer actor. Permission evaluation still happens in the
 * platform guard + RLS; this is defense in depth for filtering and writes.
 */
export type ShiftActor = {
  staffId: string;
  orgId: string;
  permissions: readonly PlatformPermission[];
};

function has(actor: ShiftActor, permission: PlatformPermission): boolean {
  return actor.permissions.includes(permission);
}

function requireStaff(actor: ShiftActor): void {
  if (!actor.staffId) {
    throw new ShiftDomainError("FORBIDDEN", "staff identity is required");
  }
}

export function canManageShifts(actor: ShiftActor): boolean {
  return has(actor, "shift.manage");
}

export function canViewOwnShifts(actor: ShiftActor): boolean {
  return has(actor, "shift.view_own") || canManageShifts(actor);
}

export function canRequestShifts(actor: ShiftActor): boolean {
  return has(actor, "shift.request") || canManageShifts(actor);
}

export async function listWorkLocations(
  ports: ShiftPorts,
  actor: ShiftActor,
): Promise<WorkLocation[]> {
  requireStaff(actor);
  if (!canViewOwnShifts(actor) && !canRequestShifts(actor)) {
    throw new ShiftDomainError("FORBIDDEN", "shift permission required");
  }
  return ports.locations.listActive(actor.orgId);
}

export async function createWorkLocation(
  ports: ShiftPorts,
  actor: ShiftActor,
  input: CreateWorkLocationInput,
): Promise<WorkLocation> {
  requireStaff(actor);
  if (!canManageShifts(actor)) {
    throw new ShiftDomainError("FORBIDDEN", "shift.manage required");
  }
  const code = input.code.trim();
  const name = input.name.trim();
  if (!code || !name) {
    throw new ShiftDomainError("INVALID_PERIOD", "location code and name are required");
  }
  return ports.locations.create(actor.orgId, {
    code,
    name,
    addressText: input.addressText ?? null,
  });
}

export async function listShifts(
  ports: ShiftPorts,
  actor: ShiftActor,
  query: { from?: string; to?: string; staffId?: string },
): Promise<Shift[]> {
  requireStaff(actor);
  if (canManageShifts(actor)) {
    return ports.shifts.list(actor.orgId, query);
  }
  if (!has(actor, "shift.view_own")) {
    throw new ShiftDomainError("FORBIDDEN", "shift.view_own required");
  }
  return ports.shifts.list(actor.orgId, { ...query, staffId: actor.staffId });
}

export async function listShiftRequests(
  ports: ShiftPorts,
  actor: ShiftActor,
  query: { periodStart?: string; periodEnd?: string; staffId?: string },
): Promise<ShiftRequest[]> {
  requireStaff(actor);
  if (canManageShifts(actor)) {
    return ports.requests.list(actor.orgId, query);
  }
  if (!has(actor, "shift.request")) {
    throw new ShiftDomainError("FORBIDDEN", "shift.request required");
  }
  return ports.requests.list(actor.orgId, { ...query, staffId: actor.staffId });
}

export async function createShiftRequestDraft(
  ports: ShiftPorts,
  actor: ShiftActor,
  input: CreateShiftRequestDraftInput,
): Promise<ShiftRequest> {
  requireStaff(actor);
  if (!canRequestShifts(actor)) {
    throw new ShiftDomainError("FORBIDDEN", "shift.request required");
  }
  if (input.forStaffId && input.forStaffId !== actor.staffId && !canManageShifts(actor)) {
    throw new ShiftDomainError("FORBIDDEN", "cannot create a request for another staff");
  }
  assertRequestPeriod(input.periodStart, input.periodEnd);
  assertUniqueDates(input.dates);
  const dates = input.dates.map((row) =>
    assertPreferenceDate(row, input.periodStart, input.periodEnd),
  );
  return ports.requests.createOrReplaceDraft(actor.orgId, actor.staffId, {
    ...input,
    dates,
  });
}

export async function submitShiftRequest(
  ports: ShiftPorts,
  actor: ShiftActor,
  requestId: string,
): Promise<ShiftRequest> {
  requireStaff(actor);
  if (!canRequestShifts(actor)) {
    throw new ShiftDomainError("FORBIDDEN", "shift.request required");
  }
  return ports.requests.submit(actor.orgId, requestId);
}

export async function cancelShiftRequest(
  ports: ShiftPorts,
  actor: ShiftActor,
  requestId: string,
): Promise<ShiftRequest> {
  requireStaff(actor);
  if (!canRequestShifts(actor)) {
    throw new ShiftDomainError("FORBIDDEN", "shift.request required");
  }
  return ports.requests.cancel(actor.orgId, requestId);
}

export async function createDraftShift(
  ports: ShiftPorts,
  actor: ShiftActor,
  input: CreateShiftInput,
): Promise<Shift> {
  requireStaff(actor);
  if (!canManageShifts(actor)) {
    throw new ShiftDomainError("FORBIDDEN", "shift.manage required");
  }
  const times = assertShiftSchedule(input.startTime, input.endTime, input.endDayOffset);
  const endDayOffset = times.endDayOffset;
  const source = input.source ?? "internal";
  const externalRef = assertExternalRef(source, input.externalRef);
  const preReportUrl = assertPreReportUrl(input.preReportUrl);
  return ports.shifts.createDraft(actor.orgId, {
    ...input,
    startTime: times.startTime,
    endTime: times.endTime,
    endDayOffset,
    source,
    externalRef,
    preReportUrl,
  });
}

export async function updateDraftShift(
  ports: ShiftPorts,
  actor: ShiftActor,
  shiftId: string,
  input: UpdateShiftDraftInput,
): Promise<Shift> {
  requireStaff(actor);
  if (!canManageShifts(actor)) {
    throw new ShiftDomainError("FORBIDDEN", "shift.manage required");
  }
  const existing = await ports.shifts.getById(actor.orgId, shiftId);
  if (!existing) {
    throw new ShiftDomainError("NOT_FOUND", "shift");
  }
  if (existing.status !== "draft") {
    throw new ShiftDomainError("SHIFT_IMMUTABLE", "only draft shifts may be edited");
  }
  const startTime = input.startTime !== undefined ? input.startTime : existing.startTime;
  const endTime = input.endTime !== undefined ? input.endTime : existing.endTime;
  const endDayOffset =
    input.endDayOffset !== undefined ? input.endDayOffset : existing.endDayOffset;
  const times = assertShiftSchedule(startTime, endTime, endDayOffset);
  const preReportUrl =
    input.preReportUrl !== undefined
      ? assertPreReportUrl(input.preReportUrl)
      : existing.preReportUrl;
  return ports.shifts.updateDraft(actor.orgId, shiftId, {
    workDate: input.workDate ?? existing.workDate,
    startTime: times.startTime,
    endTime: times.endTime,
    endDayOffset: times.endDayOffset,
    workLocationId:
      input.workLocationId !== undefined ? input.workLocationId : existing.workLocationId,
    note: input.note !== undefined ? input.note : existing.note,
    preReportUrl,
  });
}

export async function publishShift(
  ports: ShiftPorts,
  actor: ShiftActor,
  shiftId: string,
): Promise<Shift> {
  requireStaff(actor);
  if (!canManageShifts(actor)) {
    throw new ShiftDomainError("FORBIDDEN", "shift.manage required");
  }
  return ports.shifts.publish(actor.orgId, shiftId);
}

export async function cancelShift(
  ports: ShiftPorts,
  actor: ShiftActor,
  shiftId: string,
): Promise<Shift> {
  requireStaff(actor);
  if (!canManageShifts(actor)) {
    throw new ShiftDomainError("FORBIDDEN", "shift.manage required");
  }
  return ports.shifts.cancel(actor.orgId, shiftId);
}
