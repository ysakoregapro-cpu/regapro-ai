import "server-only";
import { staffFieldsOf, type AccessContext } from "@regapro/security";
import { hasPermission } from "@regapro/platform";
import {
  WorkDomainError,
  confirmWorkRecord as confirmWorkRecordUseCase,
  createEmploymentTerm as createEmploymentTermUseCase,
  createOrUpdateWorkRecordDraft as createOrUpdateWorkRecordDraftUseCase,
  listEmploymentTerms as listEmploymentTermsUseCase,
  listWorkRecordRevisions as listWorkRecordRevisionsUseCase,
  listWorkRecords as listWorkRecordsUseCase,
  reopenWorkRecord as reopenWorkRecordUseCase,
  revokeEmploymentTerm as revokeEmploymentTermUseCase,
  voidWorkRecord as voidWorkRecordUseCase,
  type CreateEmploymentTermInput,
  type CreateWorkRecordDraftInput,
  type WorkActor,
} from "@regapro/work";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createSupabaseWorkRecordPorts } from "@/lib/data/persistence/supabase-work-record";

function actorFromAccess(access: AccessContext): WorkActor {
  const staff = staffFieldsOf(access);
  if (!staff.staffId || staff.staffStatus !== "active") {
    throw new WorkDomainError("FORBIDDEN", "active staff identity is required");
  }
  const permissions: Array<WorkActor["permissions"][number]> = [];
  for (const key of [
    "work_record.view_own",
    "work_record.submit",
    "work_record.manage",
    "employment_terms.manage",
  ] as const) {
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
    typeof createSupabaseWorkRecordPorts
  >[0];
  return createSupabaseWorkRecordPorts(client);
}

export async function listEmploymentTermsForAccess(
  access: AccessContext,
  query: { staffId?: string },
) {
  return listEmploymentTermsUseCase(await ports(), actorFromAccess(access), query);
}

export async function createEmploymentTermForAccess(
  access: AccessContext,
  input: CreateEmploymentTermInput,
) {
  return createEmploymentTermUseCase(await ports(), actorFromAccess(access), input);
}

export async function revokeEmploymentTermForAccess(
  access: AccessContext,
  termId: string,
  reason: string,
) {
  return revokeEmploymentTermUseCase(await ports(), actorFromAccess(access), termId, reason);
}

export async function listWorkRecordsForAccess(
  access: AccessContext,
  query: { from?: string; to?: string; staffId?: string },
) {
  return listWorkRecordsUseCase(await ports(), actorFromAccess(access), query);
}

export async function listWorkRecordRevisionsForAccess(
  access: AccessContext,
  workRecordId: string,
) {
  return listWorkRecordRevisionsUseCase(await ports(), actorFromAccess(access), workRecordId);
}

export async function createOrUpdateWorkRecordDraftForAccess(
  access: AccessContext,
  input: CreateWorkRecordDraftInput,
) {
  return createOrUpdateWorkRecordDraftUseCase(await ports(), actorFromAccess(access), input);
}

export async function confirmWorkRecordForAccess(
  access: AccessContext,
  workRecordId: string,
) {
  return confirmWorkRecordUseCase(await ports(), actorFromAccess(access), workRecordId);
}

export async function reopenWorkRecordForAccess(
  access: AccessContext,
  workRecordId: string,
  reason: string,
) {
  return reopenWorkRecordUseCase(await ports(), actorFromAccess(access), workRecordId, reason);
}

export async function voidWorkRecordForAccess(
  access: AccessContext,
  workRecordId: string,
  reason: string,
) {
  return voidWorkRecordUseCase(await ports(), actorFromAccess(access), workRecordId, reason);
}
