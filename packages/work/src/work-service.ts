import type { PlatformPermission } from "@regapro/shared";
import { WorkDomainError } from "./work-errors.js";
import type { WorkRecordPorts } from "./work-ports.js";
import type {
  CreateEmploymentTermInput,
  CreateWorkRecordDraftInput,
  EmploymentTerm,
  WorkRecord,
  WorkRecordRevision,
} from "./work-types.js";
import {
  assertAssignmentRef,
  assertConfirmEndNotFuture,
  assertHourlyWage,
  assertInclusiveTermRange,
  assertTransportFee,
  computeWorkedMinutes,
} from "./work-validation.js";
import { assertReason, assertWorkRecordMutable } from "./work-lifecycle.js";

export type WorkActor = {
  staffId: string;
  orgId: string;
  permissions: readonly PlatformPermission[];
};

function has(actor: WorkActor, permission: PlatformPermission): boolean {
  return actor.permissions.includes(permission);
}

function requireStaff(actor: WorkActor): void {
  if (!actor.staffId) {
    throw new WorkDomainError("FORBIDDEN", "staff identity is required");
  }
}

export function canManageWorkRecords(actor: WorkActor): boolean {
  return has(actor, "work_record.manage");
}

export function canSubmitWorkRecords(actor: WorkActor): boolean {
  return has(actor, "work_record.submit") || canManageWorkRecords(actor);
}

export function canViewOwnWorkRecords(actor: WorkActor): boolean {
  return (
    has(actor, "work_record.view_own") ||
    has(actor, "work_record.submit") ||
    canManageWorkRecords(actor)
  );
}

export function canManageEmploymentTerms(actor: WorkActor): boolean {
  return has(actor, "employment_terms.manage");
}

export async function listEmploymentTerms(
  ports: WorkRecordPorts,
  actor: WorkActor,
  query: { staffId?: string },
): Promise<EmploymentTerm[]> {
  requireStaff(actor);
  if (canManageEmploymentTerms(actor)) {
    return ports.terms.list(actor.orgId, query);
  }
  if (!canViewOwnWorkRecords(actor)) {
    throw new WorkDomainError("FORBIDDEN", "cannot read employment terms");
  }
  return ports.terms.list(actor.orgId, { staffId: actor.staffId });
}

export async function createEmploymentTerm(
  ports: WorkRecordPorts,
  actor: WorkActor,
  input: CreateEmploymentTermInput,
): Promise<EmploymentTerm> {
  requireStaff(actor);
  if (!canManageEmploymentTerms(actor)) {
    throw new WorkDomainError("FORBIDDEN", "employment_terms.manage required");
  }
  assertHourlyWage(input.hourlyWageYen);
  assertInclusiveTermRange(input.effectiveFrom, input.effectiveTo ?? null);
  return ports.terms.create(actor.orgId, input);
}

export async function revokeEmploymentTerm(
  ports: WorkRecordPorts,
  actor: WorkActor,
  termId: string,
  reason: string,
): Promise<EmploymentTerm> {
  requireStaff(actor);
  if (!canManageEmploymentTerms(actor)) {
    throw new WorkDomainError("FORBIDDEN", "employment_terms.manage required");
  }
  return ports.terms.revoke(actor.orgId, termId, assertReason(reason));
}

export async function listWorkRecords(
  ports: WorkRecordPorts,
  actor: WorkActor,
  query: { from?: string; to?: string; staffId?: string },
): Promise<WorkRecord[]> {
  requireStaff(actor);
  if (canManageWorkRecords(actor)) {
    return ports.records.list(actor.orgId, query);
  }
  if (!canViewOwnWorkRecords(actor)) {
    throw new WorkDomainError("FORBIDDEN", "work_record.view_own required");
  }
  return ports.records.list(actor.orgId, { ...query, staffId: actor.staffId });
}

export async function listWorkRecordRevisions(
  ports: WorkRecordPorts,
  actor: WorkActor,
  workRecordId: string,
): Promise<WorkRecordRevision[]> {
  requireStaff(actor);
  if (!canViewOwnWorkRecords(actor)) {
    throw new WorkDomainError("FORBIDDEN", "work_record.view_own required");
  }
  const record = await ports.records.getById(actor.orgId, workRecordId);
  if (!record) {
    throw new WorkDomainError("NOT_FOUND", "work record");
  }
  if (record.staffId !== actor.staffId && !canManageWorkRecords(actor)) {
    throw new WorkDomainError("FORBIDDEN", "cannot read another staff work record");
  }
  return ports.revisions.listForRecord(actor.orgId, workRecordId);
}

export async function createOrUpdateWorkRecordDraft(
  ports: WorkRecordPorts,
  actor: WorkActor,
  input: CreateWorkRecordDraftInput,
): Promise<WorkRecord> {
  requireStaff(actor);
  if (!canSubmitWorkRecords(actor)) {
    throw new WorkDomainError("FORBIDDEN", "work_record.submit required");
  }
  const targetStaffId = input.staffId ?? actor.staffId;
  if (targetStaffId !== actor.staffId && !canManageWorkRecords(actor)) {
    throw new WorkDomainError("FORBIDDEN", "cannot create a work record for another staff");
  }
  const schedule = {
    workDate: input.workDate,
    startTime: input.startTime,
    endTime: input.endTime,
    endDayOffset: input.endDayOffset ?? 0,
    breakMinutes: input.breakMinutes ?? 0,
  };
  computeWorkedMinutes(schedule);
  assertTransportFee(input.transportFeeYen ?? 0);
  assertAssignmentRef(input.assignmentSource, input.assignmentExternalRef);
  return ports.records.createOrUpdateDraft(actor.orgId, {
    ...input,
    staffId: targetStaffId,
  });
}

export async function confirmWorkRecord(
  ports: WorkRecordPorts,
  actor: WorkActor,
  workRecordId: string,
  now: Date = new Date(),
): Promise<WorkRecord> {
  requireStaff(actor);
  if (!canSubmitWorkRecords(actor)) {
    throw new WorkDomainError("FORBIDDEN", "work_record.submit required");
  }
  const record = await ports.records.getById(actor.orgId, workRecordId);
  if (!record) {
    throw new WorkDomainError("NOT_FOUND", "work record");
  }
  if (record.staffId !== actor.staffId && !canManageWorkRecords(actor)) {
    throw new WorkDomainError("FORBIDDEN", "cannot confirm another staff work record");
  }
  assertWorkRecordMutable(record.status);
  assertConfirmEndNotFuture(record, now);
  return ports.records.confirm(actor.orgId, workRecordId);
}

export async function reopenWorkRecord(
  ports: WorkRecordPorts,
  actor: WorkActor,
  workRecordId: string,
  reason: string,
): Promise<WorkRecord> {
  requireStaff(actor);
  if (!canManageWorkRecords(actor)) {
    throw new WorkDomainError("FORBIDDEN", "work_record.manage required to reopen");
  }
  return ports.records.reopen(actor.orgId, workRecordId, assertReason(reason));
}

export async function voidWorkRecord(
  ports: WorkRecordPorts,
  actor: WorkActor,
  workRecordId: string,
  reason: string,
): Promise<WorkRecord> {
  requireStaff(actor);
  if (!canSubmitWorkRecords(actor)) {
    throw new WorkDomainError("FORBIDDEN", "work_record.submit required");
  }
  const record = await ports.records.getById(actor.orgId, workRecordId);
  if (!record) {
    throw new WorkDomainError("NOT_FOUND", "work record");
  }
  if (record.status === "draft") {
    if (record.staffId !== actor.staffId && !canManageWorkRecords(actor)) {
      throw new WorkDomainError("FORBIDDEN", "cannot void another staff work record");
    }
  } else if (!canManageWorkRecords(actor)) {
    throw new WorkDomainError("FORBIDDEN", "work_record.manage required to void a confirmed record");
  }
  return ports.records.void(actor.orgId, workRecordId, assertReason(reason));
}
