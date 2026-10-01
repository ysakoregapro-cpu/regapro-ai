import "server-only";
import {
  WeeklyPayDomainError,
  type ApplicationBankSnapshotMasked,
  type BankAccountMasked,
  type BankAccountStatus,
  type BankAccountType,
  type CreateWeeklyApplicationDraftInput,
  type CreateWeeklyPayPaymentBatchInput,
  type UpsertBankAccountInput,
  type UpsertWorkerSettingsInput,
  type WeeklyApplication,
  type WeeklyApplicationItem,
  type WeeklyApplicationListQuery,
  type WeeklyApplicationStatus,
  type WeeklyPayBatchStatus,
  type WeeklyPayDailyCapScope,
  type WeeklyPayItemCalculationTrace,
  type WeeklyPayItemOutcome,
  type WeeklyPayItemResultInput,
  type WeeklyPayPaymentBatch,
  type WeeklyPayPaymentBatchItemMasked,
  type WeeklyPayPolicy,
  type WeeklyPayPolicySnapshot,
  type WeeklyPayPorts,
  type WeeklyPaySettlementLedgerEntry,
  type WeeklyPayTransferorSettings,
  type WeeklyPayTransferorUpsertInput,
  type WorkerSettings,
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
  if (/WEEKLY_PAY_NO_BANK/i.test(msg)) {
    throw new WeeklyPayDomainError("NO_BANK", msg);
  }
  if (/WEEKLY_PAY_INVALID_BANK/i.test(msg)) {
    throw new WeeklyPayDomainError("INVALID_BANK", msg);
  }
  if (/WEEKLY_PAY_BANK_KEY_MISSING/i.test(msg)) {
    throw new WeeklyPayDomainError("BANK_KEY_MISSING", msg);
  }
  if (/WEEKLY_PAY_TRANSFEROR_UNSET/i.test(msg)) {
    throw new WeeklyPayDomainError("TRANSFEROR_UNSET", msg);
  }
  if (/WEEKLY_PAY_INVALID_TRANSFEROR/i.test(msg)) {
    throw new WeeklyPayDomainError("INVALID_TRANSFEROR", msg);
  }
  if (/WEEKLY_PAY_INVALID_TRANSFER_DATE/i.test(msg)) {
    throw new WeeklyPayDomainError("INVALID_TRANSFER_DATE", msg);
  }
  if (/WEEKLY_PAY_DUPLICATE_BATCH|WEEKLY_PAY_ALREADY_PAID/i.test(msg)) {
    throw new WeeklyPayDomainError("DUPLICATE_BATCH", msg);
  }
  if (/WEEKLY_PAY_TOTAL_MISMATCH/i.test(msg)) {
    throw new WeeklyPayDomainError("TOTAL_MISMATCH", msg);
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

const BANK_MASKED_COLUMNS =
  "id, org_id, staff_id, bank_name, bank_code, branch_name, branch_code, account_type, account_number_last4, account_holder_kana, status, created_by_staff_id, created_at, updated_at, deactivated_at";

const SNAPSHOT_MASKED_COLUMNS =
  "application_id, org_id, staff_id, source_bank_account_id, bank_name, bank_code, branch_name, branch_code, account_type, account_number_last4, account_holder_kana, created_at";

function mapBankAccount(row: Record<string, unknown>): BankAccountMasked {
  if ("account_number_ciphertext" in row || "account_number" in row) {
    throw new WeeklyPayDomainError(
      "FORBIDDEN",
      "plaintext or ciphertext bank account fields must not appear in API responses",
    );
  }
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    staffId: String(row.staff_id),
    bankName: String(row.bank_name),
    bankCode: String(row.bank_code),
    branchName: String(row.branch_name),
    branchCode: String(row.branch_code),
    accountType: String(row.account_type) as BankAccountType,
    accountNumberLast4: String(row.account_number_last4),
    accountHolderKana: String(row.account_holder_kana),
    status: String(row.status) as BankAccountStatus,
    createdByStaffId: String(row.created_by_staff_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    deactivatedAt: typeof row.deactivated_at === "string" ? row.deactivated_at : null,
  };
}

function mapBankSnapshot(row: Record<string, unknown>): ApplicationBankSnapshotMasked {
  if ("account_number_ciphertext" in row || "account_number" in row) {
    throw new WeeklyPayDomainError(
      "FORBIDDEN",
      "plaintext or ciphertext bank snapshot fields must not appear in API responses",
    );
  }
  return {
    applicationId: String(row.application_id),
    orgId: String(row.org_id),
    staffId: String(row.staff_id),
    sourceBankAccountId:
      typeof row.source_bank_account_id === "string" ? row.source_bank_account_id : null,
    bankName: String(row.bank_name),
    bankCode: String(row.bank_code),
    branchName: String(row.branch_name),
    branchCode: String(row.branch_code),
    accountType: String(row.account_type) as BankAccountType,
    accountNumberLast4: String(row.account_number_last4),
    accountHolderKana: String(row.account_holder_kana),
    createdAt: String(row.created_at),
  };
}

function mapWorkerSettings(row: Record<string, unknown>): WorkerSettings {
  return {
    staffId: String(row.staff_id),
    orgId: String(row.org_id),
    weeklyPayEnabled: Boolean(row.weekly_pay_enabled),
    activeBankAccountId:
      typeof row.active_bank_account_id === "string" ? row.active_bank_account_id : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
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

function mapTransferor(row: Record<string, unknown>): WeeklyPayTransferorSettings {
  return {
    orgId: String(row.org_id),
    consignorCode: String(row.consignor_code),
    requesterNameKana: String(row.requester_name_kana),
    sourceBankCode: String(row.source_bank_code),
    sourceBankNameKana: row.source_bank_name_kana
      ? String(row.source_bank_name_kana)
      : null,
    sourceBranchCode: String(row.source_branch_code),
    sourceBranchNameKana: row.source_branch_name_kana
      ? String(row.source_branch_name_kana)
      : null,
    sourceAccountType: String(row.source_account_type) as BankAccountType,
    sourceAccountNumberLast4: String(
      row.source_account_number_last4 ??
        (typeof row.source_account_number === "string"
          ? String(row.source_account_number).slice(-4)
          : ""),
    ),
    updatedAt: String(row.updated_at),
  };
}

function mapBatch(row: Record<string, unknown>): WeeklyPayPaymentBatch {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    status: String(row.status) as WeeklyPayBatchStatus,
    bankTransferDate: String(row.bank_transfer_date),
    scheduledPaymentDate: row.scheduled_payment_date
      ? String(row.scheduled_payment_date)
      : null,
    formatCode: String(row.format_code),
    itemCount: Number(row.item_count),
    totalAmountYen: Number(row.total_amount_yen),
    contentFingerprint: String(row.content_fingerprint),
    exportCount: Number(row.export_count ?? 0),
    exportedAt: row.exported_at ? String(row.exported_at) : null,
    bankSubmittedAt: row.bank_submitted_at ? String(row.bank_submitted_at) : null,
    bankSubmissionNote: row.bank_submission_note
      ? String(row.bank_submission_note)
      : null,
    bankFileRef: row.bank_file_ref ? String(row.bank_file_ref) : null,
    createdByStaffId: String(row.created_by_staff_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    cancelledAt: row.cancelled_at ? String(row.cancelled_at) : null,
    cancelReason: row.cancel_reason ? String(row.cancel_reason) : null,
    closedAt: row.closed_at ? String(row.closed_at) : null,
  };
}

function mapBatchItem(row: Record<string, unknown>): WeeklyPayPaymentBatchItemMasked {
  const bank = (row.bank_snapshot ?? {}) as Record<string, unknown>;
  return {
    id: String(row.id),
    batchId: String(row.batch_id),
    orgId: String(row.org_id),
    applicationId: String(row.application_id),
    staffId: String(row.staff_id),
    amountYen: Number(row.amount_yen),
    weekStart: String(row.week_start),
    weekEnd: String(row.week_end),
    applicationPaymentDate: String(row.application_payment_date),
    workRecordIds: Array.isArray(row.work_record_ids)
      ? (row.work_record_ids as string[])
      : [],
    bankCode: String(bank.bankCode ?? ""),
    branchCode: String(bank.branchCode ?? ""),
    accountType: String(bank.accountType ?? "ordinary") as BankAccountType,
    accountNumberLast4: String(bank.accountNumberLast4 ?? ""),
    accountHolderKana: String(bank.accountHolderKana ?? ""),
    outcome: String(row.outcome) as WeeklyPayItemOutcome,
    paidOn: row.paid_on ? String(row.paid_on) : null,
    bankTransactionRef: row.bank_transaction_ref
      ? String(row.bank_transaction_ref)
      : null,
    failureReason: row.failure_reason ? String(row.failure_reason) : null,
  };
}

export function createSupabaseWeeklyPayPorts(
  client: Client,
  options?: { serviceClient?: Client },
): WeeklyPayPorts {
  const serviceClient = options?.serviceClient;
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
      async getBankSnapshot(_orgId, applicationId) {
        const { data, error } = await client
          .from("application_bank_snapshots")
          .select(SNAPSHOT_MASKED_COLUMNS)
          .eq("application_id", applicationId)
          .maybeSingle();
        if (error) throwFromRpc(error);
        if (!data) return null;
        return mapBankSnapshot(data);
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
    bank: {
      async listMasked(orgId, staffId) {
        let q = client
          .from("bank_accounts")
          .select(BANK_MASKED_COLUMNS)
          .eq("org_id", orgId)
          .order("updated_at", { ascending: false });
        if (staffId) q = q.eq("staff_id", staffId);
        const { data, error } = await q;
        if (error) throwFromRpc(error);
        return (data ?? []).map(mapBankAccount);
      },
      async upsert(_orgId, input: UpsertBankAccountInput) {
        const { data, error } = await client.rpc("upsert_bank_account_masked", {
          p_bank_name: input.bankName,
          p_bank_code: input.bankCode,
          p_branch_name: input.branchName,
          p_branch_code: input.branchCode,
          p_account_type: input.accountType,
          p_account_number: input.accountNumber,
          p_account_holder_kana: input.accountHolderKana,
          p_for_staff_id: input.staffId ?? null,
        });
        if (error) throwFromRpc(error);
        if (!data) throw new WeeklyPayDomainError("NOT_FOUND", "bank account");
        return mapBankAccount(data);
      },
      async deactivate(_orgId, bankAccountId) {
        const { data, error } = await client.rpc("deactivate_bank_account_masked", {
          p_bank_account_id: bankAccountId,
        });
        if (error) throwFromRpc(error);
        if (!data) throw new WeeklyPayDomainError("NOT_FOUND", "bank account");
        return mapBankAccount(data);
      },
      async getWorkerSettings(orgId, staffId) {
        const { data, error } = await client
          .from("worker_settings")
          .select(
            "staff_id, org_id, weekly_pay_enabled, active_bank_account_id, created_at, updated_at",
          )
          .eq("org_id", orgId)
          .eq("staff_id", staffId)
          .maybeSingle();
        if (error) throwFromRpc(error);
        if (!data) return null;
        return mapWorkerSettings(data);
      },
      async upsertWorkerSettings(_orgId, input: UpsertWorkerSettingsInput) {
        const { data, error } = await client.rpc("upsert_worker_settings", {
          p_weekly_pay_enabled: input.weeklyPayEnabled,
          p_active_bank_account_id: input.activeBankAccountId ?? null,
          p_for_staff_id: input.staffId ?? null,
        });
        if (error) throwFromRpc(error);
        if (!data) throw new WeeklyPayDomainError("NOT_FOUND", "worker settings");
        return mapWorkerSettings(data);
      },
      async decryptApplicationAccountNumber(..._args: [string, string]) {
        void _args;
        throw new WeeklyPayDomainError(
          "FORBIDDEN",
          "bank account decrypt is only available via authorized CSV download",
        );
      },
    },
    payments: {
      async getTransferorSettings(..._args: [string]) {
        void _args;
        const { data, error } = await client.rpc(
          "get_weekly_pay_transferor_settings_masked",
          {},
        );
        if (error) throwFromRpc(error);
        if (!data) return null;
        return mapTransferor(data as Record<string, unknown>);
      },
      async upsertTransferorSettings(_orgId, input: WeeklyPayTransferorUpsertInput) {
        const { data, error } = await client.rpc("upsert_weekly_pay_transferor_settings", {
          p_consignor_code: input.consignorCode,
          p_requester_name_kana: input.requesterNameKana,
          p_source_bank_code: input.sourceBankCode,
          p_source_bank_name_kana: input.sourceBankNameKana ?? null,
          p_source_branch_code: input.sourceBranchCode,
          p_source_branch_name_kana: input.sourceBranchNameKana ?? null,
          p_source_account_type: input.sourceAccountType,
          p_source_account_number: input.sourceAccountNumber,
        });
        if (error) throwFromRpc(error);
        if (!data) throw new WeeklyPayDomainError("NOT_FOUND", "transferor settings");
        return mapTransferor(data);
      },
      async listBatches(orgId) {
        const { data, error } = await client
          .from("weekly_pay_payment_batches")
          .select("*")
          .eq("org_id", orgId)
          .order("created_at", { ascending: false });
        if (error) throwFromRpc(error);
        return (data ?? []).map(mapBatch);
      },
      async getBatch(orgId, batchId) {
        const { data, error } = await client
          .from("weekly_pay_payment_batches")
          .select("*")
          .eq("org_id", orgId)
          .eq("id", batchId)
          .maybeSingle();
        if (error) throwFromRpc(error);
        if (!data) return null;
        return mapBatch(data);
      },
      async listBatchItems(orgId, batchId) {
        const { data, error } = await client
          .from("weekly_pay_payment_batch_items")
          .select(
            "id, batch_id, org_id, application_id, staff_id, amount_yen, week_start, week_end, application_payment_date, work_record_ids, bank_snapshot, outcome, paid_on, bank_transaction_ref, failure_reason",
          )
          .eq("org_id", orgId)
          .eq("batch_id", batchId)
          .order("created_at", { ascending: true });
        if (error) throwFromRpc(error);
        return (data ?? []).map(mapBatchItem);
      },
      async createBatch(_orgId, input: CreateWeeklyPayPaymentBatchInput) {
        const { data, error } = await client.rpc("create_weekly_pay_payment_batch", {
          p_application_ids: input.applicationIds,
          p_bank_transfer_date: input.bankTransferDate,
          p_scheduled_payment_date: input.scheduledPaymentDate ?? null,
        });
        if (error) throwFromRpc(error);
        if (!data) throw new WeeklyPayDomainError("NOT_FOUND", "payment batch");
        return mapBatch(data);
      },
      async cancelBatch(_orgId, batchId, reason) {
        const { data, error } = await client.rpc("cancel_weekly_pay_payment_batch", {
          p_batch_id: batchId,
          p_reason: reason,
        });
        if (error) throwFromRpc(error);
        if (!data) throw new WeeklyPayDomainError("NOT_FOUND", "payment batch");
        return mapBatch(data);
      },
      async recordExport(_orgId, batchId) {
        const { data, error } = await client.rpc("record_weekly_pay_batch_export", {
          p_batch_id: batchId,
        });
        if (error) throwFromRpc(error);
        if (!data) throw new WeeklyPayDomainError("NOT_FOUND", "payment batch");
        return mapBatch(data);
      },
      async recordBankSubmission(_orgId, batchId, note, bankFileRef) {
        const { data, error } = await client.rpc("record_weekly_pay_batch_bank_submission", {
          p_batch_id: batchId,
          p_note: note ?? null,
          p_bank_file_ref: bankFileRef ?? null,
        });
        if (error) throwFromRpc(error);
        if (!data) throw new WeeklyPayDomainError("NOT_FOUND", "payment batch");
        return mapBatch(data);
      },
      async recordItemResults(_orgId, batchId, results: WeeklyPayItemResultInput[]) {
        const { data, error } = await client.rpc("record_weekly_pay_batch_item_results", {
          p_batch_id: batchId,
          p_results: results.map((r) => ({
            itemId: r.itemId,
            outcome: r.outcome,
            paidOn: r.paidOn,
            bankTransactionRef: r.bankTransactionRef,
            evidenceNote: r.evidenceNote,
            failureReason: r.failureReason,
          })),
        });
        if (error) throwFromRpc(error);
        if (!data) throw new WeeklyPayDomainError("NOT_FOUND", "payment batch");
        return mapBatch(data);
      },
      async releaseItemForResend(_orgId, itemId, input) {
        const { data, error } = await client.rpc("release_weekly_pay_item_for_resend", {
          p_item_id: itemId,
          p_bank_confirmation_kind: input.bankConfirmationKind,
          p_bank_transaction_ref: input.bankTransactionRef,
          p_evidence_note: input.evidenceNote,
        });
        if (error) throwFromRpc(error);
        if (!data) throw new WeeklyPayDomainError("NOT_FOUND", "batch item");
        return mapBatchItem(data);
      },
      async listSettlementLedger(orgId, staffId) {
        let q = client
          .from("weekly_pay_settlement_ledger")
          .select("*")
          .eq("org_id", orgId)
          .order("paid_on", { ascending: false });
        if (staffId) q = q.eq("staff_id", staffId);
        const { data, error } = await q;
        if (error) throwFromRpc(error);
        return (data ?? []).map(
          (row): WeeklyPaySettlementLedgerEntry => ({
            id: String(row.id),
            orgId: String(row.org_id),
            staffId: String(row.staff_id),
            applicationId: String(row.application_id),
            batchItemId: String(row.batch_item_id),
            workRecordIds: Array.isArray(row.work_record_ids)
              ? (row.work_record_ids as string[])
              : [],
            weekStart: String(row.week_start),
            weekEnd: String(row.week_end),
            amountYen: Number(row.amount_yen),
            paidOn: String(row.paid_on),
            confirmedByStaffId: String(row.confirmed_by_staff_id),
            bankTransactionRef: row.bank_transaction_ref
              ? String(row.bank_transaction_ref)
              : null,
            evidenceNote: row.evidence_note ? String(row.evidence_note) : null,
            createdAt: String(row.created_at),
          }),
        );
      },
      async loadCsvPayload(_orgId, batchId, actorStaffId) {
        if (!serviceClient) {
          throw new WeeklyPayDomainError(
            "FORBIDDEN",
            "CSV payload requires server service client",
          );
        }
        const { data, error } = await serviceClient.rpc(
          "regapro_service_load_batch_csv_payload",
          {
            p_batch_id: batchId,
            p_actor_staff_id: actorStaffId,
          },
        );
        if (error) throwFromRpc(error);
        if (!data || typeof data !== "object") {
          throw new WeeklyPayDomainError("NOT_FOUND", "csv payload");
        }
        const raw = data as Record<string, unknown>;
        const transferor = (raw.transferor ?? {}) as Record<string, unknown>;
        const items = (raw.items as Record<string, unknown>[]) ?? [];
        return {
          batchId: String(raw.batchId),
          bankTransferDate: String(raw.bankTransferDate),
          contentFingerprint: String(raw.contentFingerprint),
          expectedItemCount: Number(raw.itemCount),
          expectedTotalAmountYen: Number(raw.totalAmountYen),
          transferor: {
            consignorCode: String(transferor.consignorCode),
            requesterNameKana: String(transferor.requesterNameKana),
            sourceBankCode: String(transferor.sourceBankCode),
            sourceBankNameKana: transferor.sourceBankNameKana
              ? String(transferor.sourceBankNameKana)
              : null,
            sourceBranchCode: String(transferor.sourceBranchCode),
            sourceBranchNameKana: transferor.sourceBranchNameKana
              ? String(transferor.sourceBranchNameKana)
              : null,
            sourceAccountType: String(transferor.sourceAccountType) as BankAccountType,
            sourceAccountNumber: String(transferor.sourceAccountNumber),
          },
          destinations: items.map((it) => ({
            bankCode: String(it.bank_code),
            bankName: it.bank_name ? String(it.bank_name) : null,
            branchCode: String(it.branch_code),
            branchName: it.branch_name ? String(it.branch_name) : null,
            accountType: String(it.account_type) as BankAccountType,
            accountNumber: String(it.account_number),
            accountHolderKana: String(it.account_holder_kana),
            amountYen: Number(it.amount_yen),
          })),
        };
      },
    },
  };
}
