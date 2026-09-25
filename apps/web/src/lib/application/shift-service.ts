import "server-only";
import { staffFieldsOf, type AccessContext } from "@regapro/security";
import { hasPermission } from "@regapro/platform";
import {
  ShiftDomainError,
  cancelShift as cancelShiftUseCase,
  cancelShiftRequest as cancelShiftRequestUseCase,
  createDraftShift as createDraftShiftUseCase,
  createShiftRequestDraft as createShiftRequestDraftUseCase,
  listShiftRequests as listShiftRequestsUseCase,
  listShifts as listShiftsUseCase,
  listWorkLocations as listWorkLocationsUseCase,
  publishShift as publishShiftUseCase,
  submitShiftRequest as submitShiftRequestUseCase,
  type CreateShiftInput,
  type CreateShiftRequestDraftInput,
  type ShiftActor,
} from "@regapro/work";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createSupabaseShiftPorts } from "@/lib/data/persistence/supabase-shift";

function actorFromAccess(access: AccessContext): ShiftActor {
  const staff = staffFieldsOf(access);
  if (!staff.staffId || staff.staffStatus !== "active") {
    throw new ShiftDomainError("FORBIDDEN", "active staff identity is required");
  }
  const permissions: Array<ShiftActor["permissions"][number]> = [];
  for (const key of ["shift.view_own", "shift.request", "shift.manage"] as const) {
    if (hasPermission(access, key)) permissions.push(key);
  }
  return {
    staffId: staff.staffId,
    orgId: access.organizationId,
    permissions,
  };
}

async function ports() {
  const client = (await createServerSupabaseClient()) as unknown as Parameters<
    typeof createSupabaseShiftPorts
  >[0];
  return createSupabaseShiftPorts(client);
}

export async function listWorkLocationsForAccess(access: AccessContext) {
  return listWorkLocationsUseCase(await ports(), actorFromAccess(access));
}

export async function listShiftsForAccess(
  access: AccessContext,
  query: { from?: string; to?: string; staffId?: string },
) {
  return listShiftsUseCase(await ports(), actorFromAccess(access), query);
}

export async function listShiftRequestsForAccess(
  access: AccessContext,
  query: { periodStart?: string; periodEnd?: string; staffId?: string },
) {
  return listShiftRequestsUseCase(await ports(), actorFromAccess(access), query);
}

export async function createShiftRequestDraftForAccess(
  access: AccessContext,
  input: CreateShiftRequestDraftInput,
) {
  return createShiftRequestDraftUseCase(await ports(), actorFromAccess(access), input);
}

export async function submitShiftRequestForAccess(
  access: AccessContext,
  requestId: string,
) {
  return submitShiftRequestUseCase(await ports(), actorFromAccess(access), requestId);
}

export async function cancelShiftRequestForAccess(
  access: AccessContext,
  requestId: string,
) {
  return cancelShiftRequestUseCase(await ports(), actorFromAccess(access), requestId);
}

export async function createDraftShiftForAccess(
  access: AccessContext,
  input: CreateShiftInput,
) {
  return createDraftShiftUseCase(await ports(), actorFromAccess(access), input);
}

export async function publishShiftForAccess(access: AccessContext, shiftId: string) {
  return publishShiftUseCase(await ports(), actorFromAccess(access), shiftId);
}

export async function cancelShiftForAccess(access: AccessContext, shiftId: string) {
  return cancelShiftUseCase(await ports(), actorFromAccess(access), shiftId);
}
