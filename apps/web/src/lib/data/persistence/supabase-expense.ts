import "server-only";
import {
  ExpenseDomainError,
  type ExpenseApplication,
  type ExpenseApplicationListQuery,
  type ExpenseApplicationStatus,
  type ExpenseApplicationType,
  type ExpenseCategory,
  type ExpensePorts,
  type UpsertExpenseApplicationDraftInput,
} from "@regapro/work";

type RpcError = { message: string; code?: string };

type Query = {
  select: (columns: string) => Query;
  eq: (column: string, value: string | boolean) => Query;
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
  if (/EXPENSE_FORBIDDEN|EXPENSE_SELF_REVIEW|42501|permission denied/i.test(msg)) {
    throw new ExpenseDomainError("FORBIDDEN", msg);
  }
  if (/EXPENSE_NOT_FOUND|PGRST116/i.test(msg)) {
    throw new ExpenseDomainError("NOT_FOUND", msg);
  }
  if (/EXPENSE_INVALID_TRANSITION/i.test(msg)) {
    throw new ExpenseDomainError("INVALID_TRANSITION", msg);
  }
  if (/EXPENSE_INVALID_REASON/i.test(msg)) {
    throw new ExpenseDomainError("INVALID_REASON", msg);
  }
  if (/EXPENSE_INVALID_AMOUNT/i.test(msg)) {
    throw new ExpenseDomainError("INVALID_AMOUNT", msg);
  }
  if (/23505|duplicate key/i.test(msg)) {
    throw new ExpenseDomainError("CONFLICT", msg);
  }
  throw new Error(msg);
}

function mapCategory(row: Record<string, unknown>): ExpenseCategory {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    code: String(row.code),
    name: String(row.name),
    sortOrder: Number(row.sort_order ?? 0),
    active: Boolean(row.active),
    createdAt: String(row.created_at),
  };
}

function mapApplication(row: Record<string, unknown>): ExpenseApplication {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    staffId: String(row.staff_id),
    status: String(row.status) as ExpenseApplicationStatus,
    currentVersionNo: Number(row.current_version_no),
    applicationType: String(row.application_type) as ExpenseApplicationType,
    categoryId: String(row.category_id),
    amountYen: Number(row.amount_yen),
    expenseDate: String(row.expense_date),
    description: String(row.description),
    fileObjectId: typeof row.file_object_id === "string" ? row.file_object_id : null,
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

export function createSupabaseExpensePorts(client: Client): ExpensePorts {
  return {
    categories: {
      async list(orgId: string) {
        const { data, error } = await client
          .from("expense_categories")
          .select("id, org_id, code, name, sort_order, active, created_at")
          .eq("org_id", orgId)
          .eq("active", true)
          .order("sort_order", { ascending: true });
        if (error) throw new Error(error.message);
        return (data ?? []).map(mapCategory);
      },
    },
    applications: {
      async list(orgId: string, query: ExpenseApplicationListQuery) {
        let q = client
          .from("expense_applications")
          .select("*")
          .eq("org_id", orgId)
          .order("expense_date", { ascending: false });
        if (query.staffId) q = q.eq("staff_id", query.staffId);
        if (query.status) q = q.eq("status", query.status);
        if (query.from) q = q.gte("expense_date", query.from);
        if (query.to) q = q.lte("expense_date", query.to);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return (data ?? []).map(mapApplication);
      },
      async getById(orgId: string, applicationId: string) {
        const { data, error } = await client
          .from("expense_applications")
          .select("*")
          .eq("org_id", orgId)
          .eq("id", applicationId)
          .maybeSingle();
        if (error) throw new Error(error.message);
        return data ? mapApplication(data) : null;
      },
      async upsertDraft(orgId: string, input: UpsertExpenseApplicationDraftInput) {
        const { data, error } = await client.rpc("upsert_expense_application_draft", {
          p_application_id: input.applicationId ?? null,
          p_staff_id: input.staffId ?? null,
          p_application_type: input.applicationType,
          p_category_id: input.categoryId,
          p_amount_yen: input.amountYen,
          p_expense_date: input.expenseDate,
          p_description: input.description,
        });
        if (error) throwFromRpc(error);
        if (!data) throw new ExpenseDomainError("NOT_FOUND", "expense application");
        const app = mapApplication(data);
        if (app.orgId !== orgId) throw new ExpenseDomainError("FORBIDDEN", "org mismatch");
        return app;
      },
      async submit(orgId: string, applicationId: string) {
        const { data, error } = await client.rpc("submit_expense_application", {
          p_application_id: applicationId,
        });
        if (error) throwFromRpc(error);
        if (!data) throw new ExpenseDomainError("NOT_FOUND", "expense application");
        const app = mapApplication(data);
        if (app.orgId !== orgId) throw new ExpenseDomainError("FORBIDDEN", "org mismatch");
        return app;
      },
      async return(orgId: string, applicationId: string, reason: string) {
        const { data, error } = await client.rpc("return_expense_application", {
          p_application_id: applicationId,
          p_reason: reason,
        });
        if (error) throwFromRpc(error);
        if (!data) throw new ExpenseDomainError("NOT_FOUND", "expense application");
        const app = mapApplication(data);
        if (app.orgId !== orgId) throw new ExpenseDomainError("FORBIDDEN", "org mismatch");
        return app;
      },
      async approve(orgId: string, applicationId: string) {
        const { data, error } = await client.rpc("approve_expense_application", {
          p_application_id: applicationId,
        });
        if (error) throwFromRpc(error);
        if (!data) throw new ExpenseDomainError("NOT_FOUND", "expense application");
        const app = mapApplication(data);
        if (app.orgId !== orgId) throw new ExpenseDomainError("FORBIDDEN", "org mismatch");
        return app;
      },
      async attachReceipt(orgId: string, input: { applicationId: string; fileObjectId: string }) {
        const { data, error } = await client.rpc("attach_expense_application_receipt", {
          p_application_id: input.applicationId,
          p_file_object_id: input.fileObjectId,
        });
        if (error) throwFromRpc(error);
        if (!data) throw new ExpenseDomainError("NOT_FOUND", "expense application");
        const app = mapApplication(data);
        if (app.orgId !== orgId) throw new ExpenseDomainError("FORBIDDEN", "org mismatch");
        return app;
      },
    },
  };
}
