import type {
  ApplicationBankSnapshotMasked,
  BankAccountMasked,
  CreateWeeklyApplicationDraftInput,
  UpsertBankAccountInput,
  UpsertWorkerSettingsInput,
  WeeklyApplication,
  WeeklyApplicationListQuery,
  WeeklyPayPolicy,
  WorkerSettings,
} from "./weekly-pay-types.js";

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
    /** Payer/manage only. Never used for normal UI display. */
    decryptApplicationAccountNumber: (
      orgId: string,
      applicationId: string,
    ) => Promise<string>;
  };
};
