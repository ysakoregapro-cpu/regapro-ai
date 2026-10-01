import "server-only";
import {
  WeeklyPayDomainError,
  type CreateWeeklyApplicationDraftInput,
  type WeeklyApplication,
  type WeeklyApplicationItem,
  type WeeklyApplicationListQuery,
  type WeeklyApplicationStatus,
  type WeeklyPayDailyCapScope,
  type WeeklyPayItemCalculationTrace,
  type WeeklyPayPolicy,
  type WeeklyPayPolicySnapshot,
  type WeeklyPayPorts,
} from "@regapro/work";

type RpcError = { message: string; code?: string };

type Query = {
  select: (columns: string) => Query;
  eq: (column: string, value: string) => Query;
  gte: (column: string, value: string) => Query;
  lte: (column: string, value: string) => Query;
  order: (column: string, options?: { ascending?: boolean }) => Query;
  maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: RpcError | null }>;
  then: Promise<{ data: Record<string, unknown>[] | null; error: RpcError | null }>["then"];
};

type Client = {
  from: (table: string) => { select: (columns: string) => Query };
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: Record<string, unknown> | null; error: RpcError | null }>;
};

function throwFromRpc(error: RpcError): never {
  const msg = error.message;
  if (/WEEKLY_PAY_FORBIDDEN|42501|row-level security|permission denied/i.test(msg)) {
    throw new WeeklyPayDomainError("FORBIDDEN", msg);
  }
  if (/WEEKLY_PAY_NOT_FOUND|PGRST116/i.test(msg)) {
    throw new WeeklyPayDomainError("NOT_FOUND", msg);
  }
  if (/WEEKLY_PAY_INVALID_TRANSITION/i.test(msg)) {
    throw new WeeklyPayDomainError("INVALID_TRANSITION", msg);
  }
  if (/WEEKLY_PAY_SELF_REVIEW/i.test(msg)) {
    throw new WeeklyPayDomainError("SELF_REVIEW", msg);
  }
  if (/WEEKLY_PAY_WEEK_CUTOFF/i.test(msg)) {
    throw new WeeklyPayDomainError("WEEK_CUTOFF", msg);
  }
  if (/WEEKLY_PAY_NO_POLICY/i.test(msg)) {
    throw new WeeklyPayDomainError("NO_POLICY", msg);
  }
  if (/WEEKLY_PAY_NO_WAGE/i.test(msg)) {
    throw new WeeklyPayDomainError("NO_WAGE", msg);
  }
  if (/WEEKLY_PAY_DUPLICATE_WEEK|WEEKLY_PAY_ALREADY_APPLIED|23505/i.test(msg)) {
    throw new WeeklyPayDomainError("CONFLICT", msg);
  }
  if (/WEEKLY_PAY_INVALID_REASON/i.test(msg)) {
    throw new WeeklyPayDomainError("INVALID_REASON", msg);
  }
  if (/WEEKLY_PAY_ZERO_AMOUNT/i.test(msg)) {
    throw new WeeklyPayDomainError("ZERO_AMOUNT", msg);
  }
  if (/WEEKLY_PAY_/i.test(msg)) {
    throw new WeeklyPayDomainError("INVALID_SELECTION", msg);
  }
  throw new Error(msg);
}

function mapPolicySnapshot(raw: unknown): WeeklyPayPolicySnapshot {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    policyId: String(o.policyId ?? ""),
    version: Number(o.version ?? 0),
    advanceRateBps: Number(o.advanceRateBps ?? 0),
    dailyCapMinutes: Number(o.dailyCapMinutes ?? 0),
    dailyCapScope: String(o.dailyCapScope ?? "per_calendar_day") as WeeklyPayDailyCapScope,
    roundingUnitYen: Number(o.roundingUnitYen ?? 500),
    includeTransportFee: Boolean(o.includeTransportFee),
    weekStartIsoDow: Number(o.weekStartIsoDow ?? 1),
    paymentOffsetDays: Number(o.paymentOffsetDays ?? 11),
  };
}

function mapPolicy(row: Record<string, unknown>): WeeklyPayPolicy {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    version: Number(row.version),
    advanceRateBps: Number(row.advance_rate_bps),
    dailyCapMinutes: Number(row.daily_cap_minutes),
    dailyCapScope: String(row.daily_cap_scope) as WeeklyPayDailyCapScope,
    roundingUnitYen: Number(row.rounding_unit_yen),
    includeTransportFee: Boolean(row.include_transport_fee),
    weekStartIsoDow: Number(row.week_start_iso_dow),
    paymentOffsetDays: Number(row.payment_offset_days),
    effectiveFrom: String(row.effective_from),
    effectiveTo: typeof row.effective_to === "string" ? row.effective_to : null,
    createdByStaffId: String(row.created_by_staff_id),
    createdAt: String(row.created_at),
    revokedAt: typeof row.revoked_at === "string" ? row.revoked_at : null,
  };
}

function mapItem(row: Record<string, unknown>): WeeklyApplicationItem {
  return {
    id: String(row.id),
    applicationId: String(row.application_id),
    orgId: String(row.org_id),
    workRecordId: String(row.work_record_id),
    workRecordRevisionNo: Number(row.work_record_revision_no),
    workDate: String(row.work_date),
    startTime: String(row.start_time).slice(0, 8),
    endTime: String(row.end_time).slice(0, 8),
    endDayOffset: Number(row.end_day_offset) as 0 | 1,
    workedMinutes: Number(row.worked_minutes),
    eligibleMinutes: Number(row.eligible_minutes),
    employmentTermId: String(row.employment_term_id),
    hourlyWageYen: Number(row.hourly_wage_yen),
    transportFeeYen: Number(row.transport_fee_yen),
    eligibleAmountYen: Number(row.eligible_amount_yen),
    policyId: String(row.policy_id),
    policyVersion: Number(row.policy_version),
    calculationTrace: row.calculation_trace as WeeklyPayItemCalculationTrace,
    createdAt: String(row.created_at),
  };
}

function mapApplication(row: Record<string, unknown>): WeeklyApplication {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    staffId: String(row.staff_id),
    weekStart: String(row.week_start),
    weekEnd: String(row.week_end),
    cutoffAt: String(row.cutoff_at),
    paymentDate: String(row.payment_date),
    status: String(row.status) as WeeklyApplicationStatus,
    totalAmountYen: Number(row.total_amount_yen),
    policyId: String(row.policy_id),
    policyVersion: Number(row.policy_version),
    policySnapshot: mapPolicySnapshot(row.policy_snapshot),
    submittedAt: typeof row.submitted_at === "string" ? row.submitted_at : null,
    submittedByStaffId:
      typeof row.submitted_by_staff_id === "string" ? row.submitted_by_staff_id : null,
    returnedAt: typeof row.returned_at === "string" ? row.returned_at : null,
    returnedByStaffId:
      typeof row.returned_by_staff_id === "string" ? row.returned_by_staff_id : null,
    returnReason: typeof row.return_reason === "string" ? row.return_reason : null,
    approvedAt: typeof row.approved_at === "string" ? row.approved_at : null,
    approvedByStaffId:
      typeof row.approved_by_staff_id === "string" ? row.approved_by_staff_id : null,
    createdByStaffId: String(row.created_by_staff_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function createSupabaseWeeklyPayPorts(client: Client): WeeklyPayPorts {
  return {
    applications: {
      async list(orgId, query: WeeklyApplicationListQuery) {
        let q = client
          .from("weekly_applications")
          .select("*")
          .eq("org_id", orgId)
          .order("week_start", { ascending: false });
        if (query.staffId) q = q.eq("staff_id", query.staffId);
        if (query.status) q = q.eq("status", query.status);
        if (query.fromWeekStart) q = q.gte("week_start", query.fromWeekStart);
        if (query.toWeekStart) q = q.lte("week_start", query.toWeekStart);
        const { data, error } = await q;
        if (error) throwFromRpc(error);
        return (data ?? []).map(mapApplication);
      },
      async getById(orgId, id) {
        const { data, error } = await client
          .from("weekly_applications")
          .select("*")
          .eq("org_id", orgId)
          .eq("id", id)
          .maybeSingle();
        if (error) throwFromRpc(error);
        if (!data) return null;
        const app = mapApplication(data);
        const items = await client
          .from("weekly_application_items")
          .select("*")
          .eq("application_id", id)
          .order("work_date", { ascending: true });
        if (items.error) throwFromRpc(items.error);
        app.items = (items.data ?? []).map(mapItem);
        return app;
      },
      async createOrReplaceDraft(_orgId, input: CreateWeeklyApplicationDraftInput) {
        const { data, error } = await client.rpc(
          "create_or_replace_weekly_application_draft",
          {
            p_work_record_ids: input.workRecordIds,
            p_for_staff_id: input.staffId ?? null,
          },
        );
        if (error) throwFromRpc(error);
        if (!data) throw new WeeklyPayDomainError("NOT_FOUND", "weekly application");
        return mapApplication(data);
      },
      async submit(_orgId, applicationId) {
        const { data, error } = await client.rpc("submit_weekly_application", {
          p_application_id: applicationId,
        });
        if (error) throwFromRpc(error);
        if (!data) throw new WeeklyPayDomainError("NOT_FOUND", "weekly application");
        return mapApplication(data);
      },
      async returnApplication(_orgId, applicationId, reason) {
        const { data, error } = await client.rpc("return_weekly_application", {
          p_application_id: applicationId,
          p_reason: reason,
        });
        if (error) throwFromRpc(error);
        if (!data) throw new WeeklyPayDomainError("NOT_FOUND", "weekly application");
        return mapApplication(data);
      },
      async approve(_orgId, applicationId) {
        const { data, error } = await client.rpc("approve_weekly_application", {
          p_application_id: applicationId,
        });
        if (error) throwFromRpc(error);
        if (!data) throw new WeeklyPayDomainError("NOT_FOUND", "weekly application");
        return mapApplication(data);
      },
    },
    policies: {
      async listActive(orgId) {
        const { data, error } = await client
          .from("weekly_pay_policies")
          .select("*")
          .eq("org_id", orgId)
          .order("version", { ascending: false });
        if (error) throwFromRpc(error);
        return (data ?? [])
          .filter((row) => row.revoked_at == null)
          .map(mapPolicy);
      },
      async upsert(_orgId, input) {
        const { data, error } = await client.rpc("upsert_weekly_pay_policy", {
          p_advance_rate_bps: input.advanceRateBps,
          p_daily_cap_minutes: input.dailyCapMinutes,
          p_daily_cap_scope: input.dailyCapScope,
          p_rounding_unit_yen: input.roundingUnitYen,
          p_include_transport_fee: input.includeTransportFee,
          p_week_start_iso_dow: input.weekStartIsoDow,
          p_payment_offset_days: input.paymentOffsetDays,
          p_effective_from: input.effectiveFrom,
          p_effective_to: input.effectiveTo ?? null,
        });
        if (error) throwFromRpc(error);
        if (!data) throw new WeeklyPayDomainError("NOT_FOUND", "weekly pay policy");
        return mapPolicy(data);
      },
    },
  };
}
