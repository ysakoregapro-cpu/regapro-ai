import type {
  CreateWeeklyApplicationDraftInput,
  WeeklyApplication,
  WeeklyApplicationListQuery,
  WeeklyPayPolicy,
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
};
