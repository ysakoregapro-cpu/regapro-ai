import "server-only";
import {
  ShiftDomainError,
  type CreateShiftInput,
  type CreateShiftRequestDraftInput,
  type Shift,
  type ShiftEndDayOffset,
  type ShiftPreferenceType,
  type ShiftPorts,
  type ShiftRequest,
  type ShiftRequestDate,
  type ShiftRequestListQuery,
  type ShiftSource,
  type ShiftStatus,
  type ShiftListQuery,
  type WorkLocation,
} from "@regapro/work";

type RpcError = { message: string; code?: string };

type ShiftQuery = {
  select: (columns: string) => ShiftQuery;
  eq: (column: string, value: string | boolean) => ShiftQuery;
  gte: (column: string, value: string) => ShiftQuery;
  lte: (column: string, value: string) => ShiftQuery;
  is: (column: string, value: null) => ShiftQuery;
  in: (column: string, values: string[]) => ShiftQuery;
  order: (column: string, options?: { ascending?: boolean }) => ShiftQuery;
  maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: RpcError | null }>;
  then: Promise<{ data: Record<string, unknown>[] | null; error: RpcError | null }>["then"];
};

type ShiftClient = {
  from: (table: string) => {
    select: (columns: string) => ShiftQuery;
    insert: (row: Record<string, unknown>) => {
      select: (columns: string) => {
        single: () => Promise<{ data: Record<string, unknown> | null; error: RpcError | null }>;
      };
    };
  };
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: Record<string, unknown> | null; error: RpcError | null }>;
};

function throwFromRpc(error: RpcError): never {
  const msg = error.message;
  if (/SHIFT_FORBIDDEN|42501|row-level security|permission denied/i.test(msg)) {
    throw new ShiftDomainError("FORBIDDEN", msg);
  }
  if (/SHIFT_NOT_FOUND|PGRST116/i.test(msg)) {
    throw new ShiftDomainError("NOT_FOUND", msg);
  }
  if (/SHIFT_REQUEST_IMMUTABLE/i.test(msg)) {
    throw new ShiftDomainError("REQUEST_IMMUTABLE", msg);
  }
  if (/SHIFT_IMMUTABLE/i.test(msg)) {
    throw new ShiftDomainError("SHIFT_IMMUTABLE", msg);
  }
  if (/SHIFT_INVALID_TRANSITION/i.test(msg)) {
    throw new ShiftDomainError("INVALID_TRANSITION", msg);
  }
  if (/SHIFT_DATE_OUT_OF_PERIOD/i.test(msg)) {
    throw new ShiftDomainError("DATE_OUT_OF_PERIOD", msg);
  }
  if (/SHIFT_INVALID_PERIOD|SHIFT_ONE_SIDED|23514/i.test(msg)) {
    throw new ShiftDomainError("INVALID_PERIOD", msg);
  }
  if (/23505|duplicate key|uq_shifts_external_ref|uq_shift_requests/i.test(msg)) {
    throw new ShiftDomainError("CONFLICT", msg);
  }
  throw new Error(msg);
}

function asIsoTime(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return value.length >= 5 ? value.slice(0, 8) : value;
}

function mapLocation(row: Record<string, unknown>): WorkLocation {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    code: String(row.code),
    name: String(row.name),
    addressText: typeof row.address_text === "string" ? row.address_text : null,
    isActive: Boolean(row.is_active),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    deletedAt: typeof row.deleted_at === "string" ? row.deleted_at : null,
  };
}

function mapRequestDate(row: Record<string, unknown>): ShiftRequestDate {
  return {
    id: String(row.id),
    shiftRequestId: String(row.shift_request_id),
    orgId: String(row.org_id),
    workDate: String(row.work_date),
    preferenceType: row.preference_type as ShiftPreferenceType,
    startTime: asIsoTime(row.start_time),
    endTime: asIsoTime(row.end_time),
    workLocationId: typeof row.work_location_id === "string" ? row.work_location_id : null,
    note: typeof row.note === "string" ? row.note : null,
    timeUnspecified: Boolean(row.time_unspecified),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapRequest(row: Record<string, unknown>, dates: ShiftRequestDate[]): ShiftRequest {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    staffId: String(row.staff_id),
    periodStart: String(row.period_start),
    periodEnd: String(row.period_end),
    version: Number(row.version),
    previousRequestId: typeof row.previous_request_id === "string" ? row.previous_request_id : null,
    status: row.status as ShiftRequest["status"],
    requestedByStaffId: String(row.requested_by_staff_id),
    submittedAt: typeof row.submitted_at === "string" ? row.submitted_at : null,
    cancelledAt: typeof row.cancelled_at === "string" ? row.cancelled_at : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    dates,
  };
}

function mapShift(row: Record<string, unknown>): Shift {
  const offset = Number(row.end_day_offset);
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    staffId: String(row.staff_id),
    workDate: String(row.work_date),
    startTime: asIsoTime(row.start_time),
    endTime: asIsoTime(row.end_time),
    endDayOffset: (offset === 1 ? 1 : 0) as ShiftEndDayOffset,
    workLocationId: typeof row.work_location_id === "string" ? row.work_location_id : null,
    source: row.source as ShiftSource,
    sourceRequestDateId:
      typeof row.source_request_date_id === "string" ? row.source_request_date_id : null,
    externalRef: typeof row.external_ref === "string" ? row.external_ref : null,
    status: row.status as ShiftStatus,
    note: typeof row.note === "string" ? row.note : null,
    preReportUrl: typeof row.pre_report_url === "string" ? row.pre_report_url : null,
    timeUnspecified: Boolean(row.time_unspecified),
    publishedAt: typeof row.published_at === "string" ? row.published_at : null,
    publishedByStaffId:
      typeof row.published_by_staff_id === "string" ? row.published_by_staff_id : null,
    cancelledAt: typeof row.cancelled_at === "string" ? row.cancelled_at : null,
    cancelledByStaffId:
      typeof row.cancelled_by_staff_id === "string" ? row.cancelled_by_staff_id : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

async function loadDates(
  client: ShiftClient,
  requestIds: string[],
): Promise<Map<string, ShiftRequestDate[]>> {
  const byRequest = new Map<string, ShiftRequestDate[]>();
  if (requestIds.length === 0) return byRequest;
  const { data, error } = await client
    .from("shift_request_dates")
    .select("*")
    .in("shift_request_id", requestIds)
    .order("work_date");
  if (error) throwFromRpc(error);
  for (const row of data ?? []) {
    const mapped = mapRequestDate(row);
    const list = byRequest.get(mapped.shiftRequestId) ?? [];
    list.push(mapped);
    byRequest.set(mapped.shiftRequestId, list);
  }
  return byRequest;
}

export function createSupabaseShiftPorts(client: ShiftClient): ShiftPorts {
  return {
    locations: {
      async listActive(orgId) {
        const { data, error } = await client
          .from("work_locations")
          .select("*")
          .eq("org_id", orgId)
          .eq("is_active", true)
          .is("deleted_at", null)
          .order("name");
        if (error) throwFromRpc(error);
        return (data ?? []).map(mapLocation);
      },
    },
    requests: {
      async getById(orgId, id) {
        const { data, error } = await client
          .from("shift_requests")
          .select("*")
          .eq("org_id", orgId)
          .eq("id", id)
          .maybeSingle();
        if (error) throwFromRpc(error);
        if (!data) return null;
        const dates = await loadDates(client, [id]);
        return mapRequest(data, dates.get(id) ?? []);
      },
      async list(orgId, query: ShiftRequestListQuery) {
        let q = client.from("shift_requests").select("*").eq("org_id", orgId);
        if (query.staffId) q = q.eq("staff_id", query.staffId);
        if (query.periodStart) q = q.eq("period_start", query.periodStart);
        if (query.periodEnd) q = q.eq("period_end", query.periodEnd);
        const { data, error } = await q.order("period_start", { ascending: false });
        if (error) throwFromRpc(error);
        const rows = data ?? [];
        const dates = await loadDates(client, rows.map((row) => String(row.id)));
        return rows.map((row) => mapRequest(row, dates.get(String(row.id)) ?? []));
      },
      async createOrReplaceDraft(
        _orgId,
        _actorStaffId,
        input: CreateShiftRequestDraftInput,
      ) {
        const { data, error } = await client.rpc("create_or_replace_shift_request_draft", {
          p_period_start: input.periodStart,
          p_period_end: input.periodEnd,
          p_dates: input.dates.map((row) => ({
            work_date: row.workDate,
            preference_type: row.preferenceType,
            start_time: row.startTime ?? null,
            end_time: row.endTime ?? null,
            work_location_id: row.workLocationId ?? null,
            note: row.note ?? null,
          })),
          p_for_staff_id: input.forStaffId ?? null,
        });
        if (error) throwFromRpc(error);
        if (!data) throw new ShiftDomainError("NOT_FOUND", "request");
        const dates = await loadDates(client, [String(data.id)]);
        return mapRequest(data, dates.get(String(data.id)) ?? []);
      },
      async submit(_orgId, requestId) {
        const { data, error } = await client.rpc("submit_shift_request", {
          p_request_id: requestId,
        });
        if (error) throwFromRpc(error);
        if (!data) throw new ShiftDomainError("NOT_FOUND", "request");
        const dates = await loadDates(client, [requestId]);
        return mapRequest(data, dates.get(requestId) ?? []);
      },
      async cancel(_orgId, requestId) {
        const { data, error } = await client.rpc("cancel_shift_request", {
          p_request_id: requestId,
        });
        if (error) throwFromRpc(error);
        if (!data) throw new ShiftDomainError("NOT_FOUND", "request");
        const dates = await loadDates(client, [requestId]);
        return mapRequest(data, dates.get(requestId) ?? []);
      },
    },
    shifts: {
      async getById(orgId, id) {
        const { data, error } = await client
          .from("shifts")
          .select("*")
          .eq("org_id", orgId)
          .eq("id", id)
          .maybeSingle();
        if (error) throwFromRpc(error);
        return data ? mapShift(data) : null;
      },
      async list(orgId, query: ShiftListQuery) {
        let q = client.from("shifts").select("*").eq("org_id", orgId);
        if (query.staffId) q = q.eq("staff_id", query.staffId);
        if (query.from) q = q.gte("work_date", query.from);
        if (query.to) q = q.lte("work_date", query.to);
        const { data, error } = await q.order("work_date");
        if (error) throwFromRpc(error);
        return (data ?? []).map(mapShift);
      },
      async createDraft(orgId, input: CreateShiftInput) {
        const { data, error } = await client
          .from("shifts")
          .insert({
            org_id: orgId,
            staff_id: input.staffId,
            work_date: input.workDate,
            start_time: input.startTime ?? null,
            end_time: input.endTime ?? null,
            end_day_offset: input.endDayOffset ?? 0,
            work_location_id: input.workLocationId ?? null,
            source: input.source ?? "internal",
            source_request_date_id: input.sourceRequestDateId ?? null,
            external_ref: input.externalRef ?? null,
            status: "draft",
            note: input.note ?? null,
            pre_report_url: input.preReportUrl ?? null,
          })
          .select("*")
          .single();
        if (error) throwFromRpc(error);
        if (!data) throw new ShiftDomainError("NOT_FOUND", "shift");
        return mapShift(data);
      },
      async publish(_orgId, shiftId) {
        const { data, error } = await client.rpc("publish_shift", { p_shift_id: shiftId });
        if (error) throwFromRpc(error);
        if (!data) throw new ShiftDomainError("NOT_FOUND", "shift");
        return mapShift(data);
      },
      async cancel(_orgId, shiftId) {
        const { data, error } = await client.rpc("cancel_shift", { p_shift_id: shiftId });
        if (error) throwFromRpc(error);
        if (!data) throw new ShiftDomainError("NOT_FOUND", "shift");
        return mapShift(data);
      },
    },
  };
}
