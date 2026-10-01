import "server-only";
import {
  SalesDomainError,
  type AllocationRuleStatus,
  type CorrectPersonalSalesCaseInput,
  type CreatePersonalSalesCaseInput,
  type PersonalSalesAllocation,
  type PersonalSalesAllocationRuleVersion,
  type PersonalSalesCase,
  type PersonalSalesCaseListQuery,
  type PersonalSalesCaseStatus,
  type SalesPorts,
  type UpsertAllocationRuleDraftInput,
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
  if (/SALES_FORBIDDEN|42501|permission denied/i.test(msg)) {
    throw new SalesDomainError("FORBIDDEN", msg);
  }
  if (/SALES_NOT_FOUND|PGRST116/i.test(msg)) {
    throw new SalesDomainError("NOT_FOUND", msg);
  }
  if (/SALES_INVALID_TRANSITION/i.test(msg)) {
    throw new SalesDomainError("INVALID_TRANSITION", msg);
  }
  if (/SALES_INVALID_ALLOCATION|SALES_NO_APPROVED_RULE/i.test(msg)) {
    throw new SalesDomainError("INVALID_ALLOCATION", msg);
  }
  throw new Error(msg);
}

function mapAllocation(row: Record<string, unknown>): PersonalSalesAllocation {
  return {
    id: String(row.id),
    caseId: String(row.case_id),
    orgId: String(row.org_id),
    staffId: String(row.staff_id),
    allocationType: typeof row.allocation_type === "string" ? row.allocation_type : null,
    shareRateBps: Number(row.share_rate_bps),
    amountYen: Number(row.amount_yen),
    allocatedProfitInclYen:
      row.allocated_profit_incl_yen == null ? null : Number(row.allocated_profit_incl_yen),
    allocationRuleVersionId:
      typeof row.allocation_rule_version_id === "string"
        ? row.allocation_rule_version_id
        : null,
    createdAt: String(row.created_at),
  };
}

function mapCase(row: Record<string, unknown>, allocations: PersonalSalesAllocation[]): PersonalSalesCase {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    staffId: typeof row.staff_id === "string" ? row.staff_id : null,
    occurredOn: String(row.occurred_on),
    title: String(row.title),
    totalAmountYen: Number(row.total_amount_yen),
    caseProfitInclYen: row.case_profit_incl_yen == null ? null : Number(row.case_profit_incl_yen),
    status: String(row.status) as PersonalSalesCaseStatus,
    note: typeof row.note === "string" ? row.note : null,
    sourceRef: row.source_ref ?? {},
    correctedCaseId: typeof row.corrected_case_id === "string" ? row.corrected_case_id : null,
    createdByStaffId: String(row.created_by_staff_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    allocations,
  };
}

function mapRule(row: Record<string, unknown>): PersonalSalesAllocationRuleVersion {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    version: Number(row.version),
    status: String(row.status) as AllocationRuleStatus,
    effectiveFrom: String(row.effective_from),
    effectiveTo: typeof row.effective_to === "string" ? row.effective_to : null,
    rulePayload: row.rule_payload,
    createdByStaffId: String(row.created_by_staff_id),
    approvedByStaffId:
      typeof row.approved_by_staff_id === "string" ? row.approved_by_staff_id : null,
    approvedAt: typeof row.approved_at === "string" ? row.approved_at : null,
    revokedAt: typeof row.revoked_at === "string" ? row.revoked_at : null,
    createdAt: String(row.created_at),
  };
}

async function loadAllocations(client: Client, caseIds: string[]): Promise<Map<string, PersonalSalesAllocation[]>> {
  const map = new Map<string, PersonalSalesAllocation[]>();
  if (!caseIds.length) return map;
  const { data, error } = await client.from("personal_sales_allocations").select("*");
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    const alloc = mapAllocation(row);
    if (!caseIds.includes(alloc.caseId)) continue;
    const list = map.get(alloc.caseId) ?? [];
    list.push(alloc);
    map.set(alloc.caseId, list);
  }
  return map;
}

export function createSupabaseSalesPorts(client: Client): SalesPorts {
  return {
    cases: {
      async list(orgId: string, query: PersonalSalesCaseListQuery) {
        let q = client
          .from("personal_sales_cases")
          .select("*")
          .eq("org_id", orgId)
          .order("occurred_on", { ascending: false });
        if (query.staffId) q = q.eq("staff_id", query.staffId);
        if (query.status) q = q.eq("status", query.status);
        if (query.from) q = q.gte("occurred_on", query.from);
        if (query.to) q = q.lte("occurred_on", query.to);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        const rows = data ?? [];
        const allocMap = await loadAllocations(
          client,
          rows.map((r) => String(r.id)),
        );
        return rows.map((r) => mapCase(r, allocMap.get(String(r.id)) ?? []));
      },
      async getById(orgId: string, caseId: string) {
        const { data, error } = await client
          .from("personal_sales_cases")
          .select("*")
          .eq("org_id", orgId)
          .eq("id", caseId)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) return null;
        const allocMap = await loadAllocations(client, [caseId]);
        return mapCase(data, allocMap.get(caseId) ?? []);
      },
      async create(orgId: string, input: CreatePersonalSalesCaseInput) {
        const { data, error } = await client.rpc("create_personal_sales_case", {
          p_occurred_on: input.occurredOn,
          p_title: input.title,
          p_total_amount_yen: input.totalAmountYen,
          p_note: input.note ?? null,
          p_staff_id: input.staffId ?? null,
          p_allocations: input.allocations.map(
            (a: { staffId: string; shareRateBps: number; amountYen: number }) => ({
              staffId: a.staffId,
              shareRateBps: a.shareRateBps,
              amountYen: a.amountYen,
            }),
          ),
          p_allocation_rule_version_id: input.allocationRuleVersionId ?? null,
        });
        if (error) throwFromRpc(error);
        if (!data) throw new SalesDomainError("NOT_FOUND", "personal sales case");
        const id = String(data.id);
        const full = await this.getById(orgId, id);
        if (!full) throw new SalesDomainError("NOT_FOUND", "personal sales case");
        return full;
      },
      async voidCase(orgId: string, caseId: string, reason: string) {
        const { data, error } = await client.rpc("void_personal_sales_case", {
          p_case_id: caseId,
          p_reason: reason,
        });
        if (error) throwFromRpc(error);
        if (!data) throw new SalesDomainError("NOT_FOUND", "personal sales case");
        const full = await this.getById(orgId, caseId);
        if (!full) throw new SalesDomainError("NOT_FOUND", "personal sales case");
        return full;
      },
      async correct(orgId: string, input: CorrectPersonalSalesCaseInput) {
        const { data, error } = await client.rpc("correct_personal_sales_case", {
          p_case_id: input.caseId,
          p_occurred_on: input.occurredOn,
          p_title: input.title,
          p_total_amount_yen: input.totalAmountYen,
          p_note: input.note ?? null,
          p_allocations: input.allocations.map(
            (a: { staffId: string; shareRateBps: number; amountYen: number }) => ({
              staffId: a.staffId,
              shareRateBps: a.shareRateBps,
              amountYen: a.amountYen,
            }),
          ),
          p_reason: input.reason,
        });
        if (error) throwFromRpc(error);
        if (!data) throw new SalesDomainError("NOT_FOUND", "personal sales case");
        const id = String(data.id);
        const full = await this.getById(orgId, id);
        if (!full) throw new SalesDomainError("NOT_FOUND", "personal sales case");
        return full;
      },
    },
    rules: {
      async list(orgId: string) {
        const { data, error } = await client
          .from("personal_sales_allocation_rule_versions")
          .select("*")
          .eq("org_id", orgId)
          .order("version", { ascending: false });
        if (error) throw new Error(error.message);
        return (data ?? []).map(mapRule);
      },
      async upsertDraft(orgId: string, input: UpsertAllocationRuleDraftInput) {
        const { data, error } = await client.rpc("upsert_personal_sales_allocation_rule_draft", {
          p_effective_from: input.effectiveFrom,
          p_effective_to: input.effectiveTo ?? null,
          p_rule_payload: input.rulePayload ?? {},
        });
        if (error) throwFromRpc(error);
        if (!data) throw new SalesDomainError("NOT_FOUND", "allocation rule");
        const rule = mapRule(data);
        if (rule.orgId !== orgId) throw new SalesDomainError("FORBIDDEN", "org mismatch");
        return rule;
      },
      async approve(orgId: string, ruleVersionId: string) {
        const { data, error } = await client.rpc("approve_personal_sales_allocation_rule", {
          p_rule_version_id: ruleVersionId,
        });
        if (error) throwFromRpc(error);
        if (!data) throw new SalesDomainError("NOT_FOUND", "allocation rule");
        const rule = mapRule(data);
        if (rule.orgId !== orgId) throw new SalesDomainError("FORBIDDEN", "org mismatch");
        return rule;
      },
      async revoke(orgId: string, ruleVersionId: string, reason: string) {
        const { data, error } = await client.rpc("revoke_personal_sales_allocation_rule", {
          p_rule_version_id: ruleVersionId,
          p_reason: reason,
        });
        if (error) throwFromRpc(error);
        if (!data) throw new SalesDomainError("NOT_FOUND", "allocation rule");
        const rule = mapRule(data);
        if (rule.orgId !== orgId) throw new SalesDomainError("FORBIDDEN", "org mismatch");
        return rule;
      },
    },
  };
}
