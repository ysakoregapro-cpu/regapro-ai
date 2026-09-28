import "server-only";
import {
  WorkDomainError,
  type CreateEmploymentTermInput,
  type CreateWorkRecordDraftInput,
  type EmploymentTerm,
  type ShiftEndDayOffset,
  type WorkRecord,
  type WorkRecordListQuery,
  type WorkRecordPorts,
  type WorkRecordRevision,
  type WorkRecordRevisionEvent,
  type WorkRecordStatus,
} from "@regapro/work";

type RpcError = { message: string; code?: string };

type WorkQuery = {
  select: (columns: string) => WorkQuery;
  eq: (column: string, value: string) => WorkQuery;
  gte: (column: string, value: string) => WorkQuery;
  lte: (column: string, value: string) => WorkQuery;
  order: (column: string, options?: { ascending?: boolean }) => WorkQuery;
  maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: RpcError | null }>;
  then: Promise<{ data: Record<string, unknown>[] | null; error: RpcError | null }>["then"];
};

type WorkClient = {
  from: (table: string) => {
    select: (columns: string) => WorkQuery;
  };
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: Record<string, unknown> | null; error: RpcError | null }>;
};

function throwFromRpc(error: RpcError): never {
  const msg = error.message;
  if (/WORK_FORBIDDEN|42501|row-level security|permission denied/i.test(msg)) {
    throw new WorkDomainError("FORBIDDEN", msg);
  }
  if (/WORK_NOT_FOUND|PGRST116/i.test(msg)) {
    throw new WorkDomainError("NOT_FOUND", msg);
  }
  if (/WORK_LOCKED_IMMUTABLE/i.test(msg)) {
    throw new WorkDomainError("LOCKED_IMMUTABLE", msg);
  }
  if (/WORK_RECORD_IMMUTABLE/i.test(msg)) {
    throw new WorkDomainError("RECORD_IMMUTABLE", msg);
  }
  if (/WORK_INVALID_TRANSITION/i.test(msg)) {
    throw new WorkDomainError("INVALID_TRANSITION", msg);
  }
  if (/WORK_FUTURE_CONFIRM/i.test(msg)) {
    throw new WorkDomainError("FUTURE_CONFIRM", msg);
  }
  if (/WORK_TERM_OVERLAP|23P01|exclusion/i.test(msg)) {
    throw new WorkDomainError("TERM_OVERLAP", msg);
  }
  if (/23505|duplicate key/i.test(msg)) {
    throw new WorkDomainError("CONFLICT", msg);
  }
  if (/WORK_INVALID_WAGE/i.test(msg)) {
    throw new WorkDomainError("INVALID_WAGE", msg);
  }
  if (/WORK_INVALID_BREAK/i.test(msg)) {
    throw new WorkDomainError("INVALID_BREAK", msg);
  }
  if (/WORK_INVALID_REASON/i.test(msg)) {
    throw new WorkDomainError("INVALID_REASON", msg);
  }
  throw new Error(msg);
}

function asIsoTime(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new WorkDomainError("INVALID_SCHEDULE", "time missing");
  }
  return value.length >= 5 ? value.slice(0, 8) : value;
}

function mapTerm(row: Record<string, unknown>): EmploymentTerm {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    staffId: String(row.staff_id),
    hourlyWageYen: Number(row.hourly_wage_yen),
    effectiveFrom: String(row.effective_from),
    effectiveTo: typeof row.effective_to === "string" ? row.effective_to : null,
    createdByStaffId: String(row.created_by_staff_id),
    createdAt: String(row.created_at),
    revokedAt: typeof row.revoked_at === "string" ? row.revoked_at : null,
    revokedByStaffId:
      typeof row.revoked_by_staff_id === "string" ? row.revoked_by_staff_id : null,
    revokeReason: typeof row.revoke_reason === "string" ? row.revoke_reason : null,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
  };
}

function mapRecord(row: Record<string, unknown>): WorkRecord {
  const offset = Number(row.end_day_offset);
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    staffId: String(row.staff_id),
    workDate: String(row.work_date),
    startTime: asIsoTime(row.start_time),
    endTime: asIsoTime(row.end_time),
    endDayOffset: (offset === 1 ? 1 : 0) as ShiftEndDayOffset,
    breakMinutes: Number(row.break_minutes),
    workedMinutes: Number(row.worked_minutes),
    transportFeeYen: Number(row.transport_fee_yen),
    workLocationId: typeof row.work_location_id === "string" ? row.work_location_id : null,
    sourceShiftId: typeof row.source_shift_id === "string" ? row.source_shift_id : null,
    assignmentSource: typeof row.assignment_source === "string" ? row.assignment_source : null,
    assignmentExternalRef:
      typeof row.assignment_external_ref === "string" ? row.assignment_external_ref : null,
    status: row.status as WorkRecordStatus,
    employmentTermId: typeof row.employment_term_id === "string" ? row.employment_term_id : null,
    hourlyWageSnapshotYen:
      typeof row.hourly_wage_snapshot_yen === "number"
        ? row.hourly_wage_snapshot_yen
        : row.hourly_wage_snapshot_yen == null
          ? null
          : Number(row.hourly_wage_snapshot_yen),
    confirmedAt: typeof row.confirmed_at === "string" ? row.confirmed_at : null,
    confirmedByStaffId:
      typeof row.confirmed_by_staff_id === "string" ? row.confirmed_by_staff_id : null,
    voidedAt: typeof row.voided_at === "string" ? row.voided_at : null,
    voidedByStaffId: typeof row.voided_by_staff_id === "string" ? row.voided_by_staff_id : null,
    voidReason: typeof row.void_reason === "string" ? row.void_reason : null,
    createdByStaffId: String(row.created_by_staff_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapRevision(row: Record<string, unknown>): WorkRecordRevision {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    workRecordId: String(row.work_record_id),
    revisionNo: Number(row.revision_no),
    eventType: row.event_type as WorkRecordRevisionEvent,
    actorStaffId: String(row.actor_staff_id),
    beforeSnapshot:
      row.before_snapshot && typeof row.before_snapshot === "object"
        ? (row.before_snapshot as Record<string, unknown>)
        : null,
    afterSnapshot:
      row.after_snapshot && typeof row.after_snapshot === "object"
        ? (row.after_snapshot as Record<string, unknown>)
        : {},
    reason: typeof row.reason === "string" ? row.reason : null,
    createdAt: String(row.created_at),
  };
}

export function createSupabaseWorkRecordPorts(client: WorkClient): WorkRecordPorts {
  return {
    terms: {
      async list(orgId, query) {
        let q = client.from("employment_terms").select("*").eq("org_id", orgId);
        if (query.staffId) q = q.eq("staff_id", query.staffId);
        const { data, error } = await q.order("effective_from", { ascending: false });
        if (error) throwFromRpc(error);
        return (data ?? []).map(mapTerm);
      },
      async create(_orgId, input: CreateEmploymentTermInput) {
        const { data, error } = await client.rpc("create_employment_term", {
          p_staff_id: input.staffId,
          p_hourly_wage_yen: input.hourlyWageYen,
          p_effective_from: input.effectiveFrom,
          p_effective_to: input.effectiveTo ?? null,
          p_close_open_ended: input.closeOpenEnded ?? true,
        });
        if (error) throwFromRpc(error);
        if (!data) throw new WorkDomainError("NOT_FOUND", "employment term");
        return mapTerm(data);
      },
      async revoke(_orgId, termId, reason) {
        const { data, error } = await client.rpc("revoke_employment_term", {
          p_term_id: termId,
          p_reason: reason,
        });
        if (error) throwFromRpc(error);
        if (!data) throw new WorkDomainError("NOT_FOUND", "employment term");
        return mapTerm(data);
      },
    },
    records: {
      async getById(orgId, id) {
        const { data, error } = await client
          .from("work_records")
          .select("*")
          .eq("org_id", orgId)
          .eq("id", id)
          .maybeSingle();
        if (error) throwFromRpc(error);
        return data ? mapRecord(data) : null;
      },
      async list(orgId, query: WorkRecordListQuery) {
        let q = client.from("work_records").select("*").eq("org_id", orgId);
        if (query.staffId) q = q.eq("staff_id", query.staffId);
        if (query.from) q = q.gte("work_date", query.from);
        if (query.to) q = q.lte("work_date", query.to);
        const { data, error } = await q.order("work_date", { ascending: false });
        if (error) throwFromRpc(error);
        return (data ?? []).map(mapRecord);
      },
      async createOrUpdateDraft(_orgId, input: CreateWorkRecordDraftInput) {
        const { data, error } = await client.rpc("create_or_update_work_record_draft", {
          p_work_record_id: input.workRecordId ?? null,
          p_staff_id: input.staffId ?? null,
          p_work_date: input.workDate,
          p_start_time: input.startTime,
          p_end_time: input.endTime,
          p_end_day_offset: input.endDayOffset ?? 0,
          p_break_minutes: input.breakMinutes ?? 0,
          p_transport_fee_yen: input.transportFeeYen ?? 0,
          p_work_location_id: input.workLocationId ?? null,
          p_source_shift_id: input.sourceShiftId ?? null,
          p_assignment_source: input.assignmentSource ?? null,
          p_assignment_external_ref: input.assignmentExternalRef ?? null,
        });
        if (error) throwFromRpc(error);
        if (!data) throw new WorkDomainError("NOT_FOUND", "work record");
        return mapRecord(data);
      },
      async confirm(_orgId, workRecordId) {
        const { data, error } = await client.rpc("confirm_work_record", {
          p_work_record_id: workRecordId,
        });
        if (error) throwFromRpc(error);
        if (!data) throw new WorkDomainError("NOT_FOUND", "work record");
        return mapRecord(data);
      },
      async reopen(_orgId, workRecordId, reason) {
        const { data, error } = await client.rpc("reopen_work_record", {
          p_work_record_id: workRecordId,
          p_reason: reason,
        });
        if (error) throwFromRpc(error);
        if (!data) throw new WorkDomainError("NOT_FOUND", "work record");
        return mapRecord(data);
      },
      async void(_orgId, workRecordId, reason) {
        const { data, error } = await client.rpc("void_work_record", {
          p_work_record_id: workRecordId,
          p_reason: reason,
        });
        if (error) throwFromRpc(error);
        if (!data) throw new WorkDomainError("NOT_FOUND", "work record");
        return mapRecord(data);
      },
    },
    revisions: {
      async listForRecord(orgId, workRecordId) {
        const { data, error } = await client
          .from("work_record_revisions")
          .select("*")
          .eq("org_id", orgId)
          .eq("work_record_id", workRecordId)
          .order("revision_no");
        if (error) throwFromRpc(error);
        return (data ?? []).map(mapRevision);
      },
    },
  };
}
