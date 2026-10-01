import type {
  ApplicationBankSnapshotMasked,
  BankAccountMasked,
  CreateWeeklyApplicationDraftInput,
  CreateWeeklyPayPaymentBatchInput,
  UpsertBankAccountInput,
  UpsertWorkerSettingsInput,
  WeeklyApplication,
  WeeklyApplicationListQuery,
  WeeklyPayItemResultInput,
  WeeklyPayPaymentBatch,
  WeeklyPayPaymentBatchItemMasked,
  WeeklyPayPolicy,
  WeeklyPaySettlementLedgerEntry,
  WeeklyPayTransferorSettings,
  WeeklyPayTransferorUpsertInput,
  WorkerSettings,
} from "./weekly-pay-types.js";
import type { SmtbCsvBuildInput } from "./weekly-pay-smtb-csv.js";

export type WeeklyPayCsvPayload = SmtbCsvBuildInput & {
  batchId: string;
  contentFingerprint: string;
};

export type WeeklyPayPorts = {
  applications: {
    list: (orgId: string, query: WeeklyApplicationListQuery) => Promise<WeeklyApplication[]>;
    getById: (orgId: string, id: string) => Promise<WeeklyApplication | null>;
    createOrReplaceDraft: (
      orgId: string,
      input: CreateWeeklyApplicationDraftInput,
    ) => Promise<WeeklyApplication>;
    submit: (orgId: string, applicationId: string) => Promise<WeeklyApplication>;
    returnApplication: (
      orgId: string,
      applicationId: string,
      reason: string,
    ) => Promise<WeeklyApplication>;
    approve: (orgId: string, applicationId: string) => Promise<WeeklyApplication>;
    getBankSnapshot: (
      orgId: string,
      applicationId: string,
    ) => Promise<ApplicationBankSnapshotMasked | null>;
  };
  policies: {
    listActive: (orgId: string) => Promise<WeeklyPayPolicy[]>;
    upsert: (
      orgId: string,
      input: {
        advanceRateBps: number;
        dailyCapMinutes: number;
        dailyCapScope: "per_work_record" | "per_calendar_day";
        roundingUnitYen: number;
        includeTransportFee: boolean;
        weekStartIsoDow: number;
        paymentOffsetDays: number;
        effectiveFrom: string;
        effectiveTo?: string | null;
      },
    ) => Promise<WeeklyPayPolicy>;
  };
  bank: {
    listMasked: (orgId: string, staffId?: string) => Promise<BankAccountMasked[]>;
    upsert: (orgId: string, input: UpsertBankAccountInput) => Promise<BankAccountMasked>;
    deactivate: (orgId: string, bankAccountId: string) => Promise<BankAccountMasked>;
    getWorkerSettings: (orgId: string, staffId: string) => Promise<WorkerSettings | null>;
    upsertWorkerSettings: (
      orgId: string,
      input: UpsertWorkerSettingsInput,
    ) => Promise<WorkerSettings>;
    /** Not used for Data API decrypt; Phase 6 CSV uses payments.loadCsvPayload. */
    decryptApplicationAccountNumber: (
      orgId: string,
      applicationId: string,
    ) => Promise<string>;
  };
  payments: {
    getTransferorSettings: (orgId: string) => Promise<WeeklyPayTransferorSettings | null>;
    upsertTransferorSettings: (
      orgId: string,
      input: WeeklyPayTransferorUpsertInput,
    ) => Promise<WeeklyPayTransferorSettings>;
    listBatches: (orgId: string) => Promise<WeeklyPayPaymentBatch[]>;
    getBatch: (orgId: string, batchId: string) => Promise<WeeklyPayPaymentBatch | null>;
    listBatchItems: (
      orgId: string,
      batchId: string,
    ) => Promise<WeeklyPayPaymentBatchItemMasked[]>;
    createBatch: (
      orgId: string,
      input: CreateWeeklyPayPaymentBatchInput,
    ) => Promise<WeeklyPayPaymentBatch>;
    cancelBatch: (orgId: string, batchId: string, reason: string) => Promise<WeeklyPayPaymentBatch>;
    recordExport: (orgId: string, batchId: string) => Promise<WeeklyPayPaymentBatch>;
    recordBankSubmission: (
      orgId: string,
      batchId: string,
      note?: string | null,
      bankFileRef?: string | null,
    ) => Promise<WeeklyPayPaymentBatch>;
    recordItemResults: (
      orgId: string,
      batchId: string,
      results: WeeklyPayItemResultInput[],
    ) => Promise<WeeklyPayPaymentBatch>;
    resolveUnknownItem: (
      orgId: string,
      itemId: string,
      outcome: "failed" | "cancelled",
      reason?: string | null,
    ) => Promise<WeeklyPayPaymentBatchItemMasked>;
    listSettlementLedger: (
      orgId: string,
      staffId?: string,
    ) => Promise<WeeklyPaySettlementLedgerEntry[]>;
    /**
     * Server-only: load decrypted CSV payload via service_role RPC.
     * Must only be called after JWT authz for actorStaffId.
     */
    loadCsvPayload: (
      orgId: string,
      batchId: string,
      actorStaffId: string,
    ) => Promise<WeeklyPayCsvPayload>;
  };
};
