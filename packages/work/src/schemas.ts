import { z } from "zod";
import { ISO_DATE_RE, ISO_TIME_RE } from "./validation.js";

const isoDate = z.string().regex(ISO_DATE_RE);
const isoTime = z.string().regex(ISO_TIME_RE);

export const ShiftRequestDateInputSchema = z.object({
  workDate: isoDate,
  preferenceType: z.enum(["hope_work", "hope_off"]),
  startTime: isoTime.nullable().optional(),
  endTime: isoTime.nullable().optional(),
  workLocationId: z.string().uuid().nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});

export const CreateShiftRequestDraftSchema = z.object({
  periodStart: isoDate,
  periodEnd: isoDate,
  dates: z.array(ShiftRequestDateInputSchema).default([]),
  forStaffId: z.string().uuid().optional(),
});

export const CreateShiftSchema = z.object({
  staffId: z.string().uuid(),
  workDate: isoDate,
  startTime: isoTime.nullable().optional(),
  endTime: isoTime.nullable().optional(),
  endDayOffset: z.union([z.literal(0), z.literal(1)]).optional(),
  workLocationId: z.string().uuid().nullable().optional(),
  source: z.enum(["internal", "spreadsheet", "imported"]).optional(),
  sourceRequestDateId: z.string().uuid().nullable().optional(),
  externalRef: z.string().max(200).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  preReportUrl: z.string().max(2000).nullable().optional(),
});

export const UpdateShiftDraftSchema = z.object({
  workDate: isoDate.optional(),
  startTime: isoTime.nullable().optional(),
  endTime: isoTime.nullable().optional(),
  endDayOffset: z.union([z.literal(0), z.literal(1)]).optional(),
  workLocationId: z.string().uuid().nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  preReportUrl: z.string().max(2000).nullable().optional(),
});

export const CreateWorkLocationSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  addressText: z.string().max(2000).nullable().optional(),
});

export const ShiftListQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  staffId: z.string().uuid().optional(),
});

export const ShiftRequestListQuerySchema = z.object({
  periodStart: isoDate.optional(),
  periodEnd: isoDate.optional(),
  staffId: z.string().uuid().optional(),
});

export const CreateEmploymentTermSchema = z.object({
  staffId: z.string().uuid(),
  hourlyWageYen: z.number().int().positive(),
  effectiveFrom: isoDate,
  effectiveTo: isoDate.nullable().optional(),
  closeOpenEnded: z.boolean().optional(),
});

export const RevokeEmploymentTermSchema = z.object({
  reason: z.string().min(1).max(2000),
});

export const EmploymentTermListQuerySchema = z.object({
  staffId: z.string().uuid().optional(),
});

export const CreateWorkRecordDraftSchema = z.object({
  workRecordId: z.string().uuid().optional(),
  staffId: z.string().uuid().optional(),
  workDate: isoDate,
  startTime: isoTime,
  endTime: isoTime,
  endDayOffset: z.union([z.literal(0), z.literal(1)]).optional(),
  breakMinutes: z.number().int().min(0).optional(),
  transportFeeYen: z.number().int().min(0).optional(),
  workLocationId: z.string().uuid().nullable().optional(),
  sourceShiftId: z.string().uuid().nullable().optional(),
  assignmentSource: z.string().max(200).nullable().optional(),
  assignmentExternalRef: z.string().max(200).nullable().optional(),
});

export const WorkRecordListQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  staffId: z.string().uuid().optional(),
});

export const WorkRecordReasonSchema = z.object({
  reason: z.string().min(1).max(2000),
});

export const CreateWeeklyApplicationDraftSchema = z.object({
  workRecordIds: z.array(z.string().uuid()).min(1),
  staffId: z.string().uuid().optional(),
});

export const WeeklyApplicationListQuerySchema = z.object({
  fromWeekStart: isoDate.optional(),
  toWeekStart: isoDate.optional(),
  staffId: z.string().uuid().optional(),
  status: z.enum(["draft", "submitted", "returned", "approved"]).optional(),
});

export const ReturnWeeklyApplicationSchema = z.object({
  reason: z.string().min(3).max(1000),
});

export const UpsertWeeklyPayPolicySchema = z.object({
  advanceRateBps: z.number().int().positive().max(10000),
  dailyCapMinutes: z.number().int().positive(),
  dailyCapScope: z.enum(["per_work_record", "per_calendar_day"]),
  roundingUnitYen: z.number().int().positive(),
  includeTransportFee: z.boolean(),
  weekStartIsoDow: z.literal(1).default(1),
  paymentOffsetDays: z.number().int().positive(),
  effectiveFrom: isoDate,
  effectiveTo: isoDate.nullable().optional(),
});

export const UpsertBankAccountSchema = z.object({
  bankName: z.string().trim().min(1).max(80),
  bankCode: z.string().regex(/^\d{4}$/),
  branchName: z.string().trim().min(1).max(80),
  branchCode: z.string().regex(/^\d{3}$/),
  accountType: z.enum(["ordinary", "current"]),
  accountNumber: z.string().regex(/^\d{7,8}$/),
  accountHolderKana: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[ァ-ヶー　 ]+$/),
  staffId: z.string().uuid().optional(),
});

export const UpsertWorkerSettingsSchema = z.object({
  weeklyPayEnabled: z.boolean(),
  activeBankAccountId: z.string().uuid().nullable().optional(),
  staffId: z.string().uuid().optional(),
});

export const BankAccountListQuerySchema = z.object({
  staffId: z.string().uuid().optional(),
});

export const UpsertWeeklyPayTransferorSettingsSchema = z.object({
  consignorCode: z.string().regex(/^20\d{8}$/),
  requesterNameKana: z.string().trim().min(1).max(40),
  sourceBankCode: z.string().regex(/^\d{4}$/),
  sourceBankNameKana: z.string().trim().max(15).nullable().optional(),
  sourceBranchCode: z.string().regex(/^\d{3}$/),
  sourceBranchNameKana: z.string().trim().max(15).nullable().optional(),
  sourceAccountType: z.enum(["ordinary", "current"]),
  sourceAccountNumber: z.string().regex(/^\d{7}$/),
});

export const CreateWeeklyPayPaymentBatchSchema = z.object({
  applicationIds: z.array(z.string().uuid()).min(1),
  bankTransferDate: isoDate,
  scheduledPaymentDate: isoDate.nullable().optional(),
});

export const CancelWeeklyPayPaymentBatchSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});

export const RecordBankSubmissionSchema = z.object({
  note: z.string().trim().max(2000).nullable().optional(),
  bankFileRef: z.string().trim().max(200).nullable().optional(),
});

export const WeeklyPayItemResultSchema = z.object({
  itemId: z.string().uuid(),
  outcome: z.enum(["paid", "failed", "unknown"]),
  paidOn: isoDate.optional(),
  bankTransactionRef: z.string().trim().min(1).max(120).optional(),
  evidenceNote: z.string().trim().min(1).max(2000).optional(),
  failureReason: z.string().trim().max(500).optional(),
});

export const RecordWeeklyPayItemResultsSchema = z.object({
  results: z.array(WeeklyPayItemResultSchema).min(1),
});

export const ReleaseItemForResendSchema = z.object({
  bankConfirmationKind: z.enum(["not_executed", "failed_at_bank"]),
  bankTransactionRef: z.string().trim().min(1).max(120),
  evidenceNote: z.string().trim().min(8).max(2000),
});

export const ExpenseApplicationListQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  staffId: z.string().uuid().optional(),
  status: z.enum(["draft", "pending", "approved", "returned"]).optional(),
});

export const UpsertExpenseApplicationDraftSchema = z.object({
  applicationId: z.string().uuid().optional(),
  staffId: z.string().uuid().optional(),
  applicationType: z.enum(["advance", "after"]),
  categoryId: z.string().uuid(),
  amountYen: z.number().int().positive(),
  expenseDate: isoDate,
  description: z.string().trim().min(1).max(4000),
});

export const ReturnExpenseApplicationSchema = z.object({
  reason: z.string().min(3).max(1000),
});

export const AttachExpenseReceiptSchema = z.object({
  fileObjectId: z.string().uuid(),
});

export const PersonalSalesCaseListQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  staffId: z.string().uuid().optional(),
  status: z.enum(["active", "voided", "corrected"]).optional(),
});

export const PersonalSalesAllocationInputSchema = z.object({
  staffId: z.string().uuid(),
  shareRateBps: z.number().int().min(0).max(10000),
  amountYen: z.number().int().min(0),
});

export const CreatePersonalSalesCaseSchema = z.object({
  staffId: z.string().uuid().optional(),
  occurredOn: isoDate,
  title: z.string().trim().min(1).max(500),
  totalAmountYen: z.number().int().positive(),
  note: z.string().trim().max(4000).nullable().optional(),
  allocations: z.array(PersonalSalesAllocationInputSchema).min(1),
  allocationRuleVersionId: z.string().uuid().nullable().optional(),
});

export const VoidPersonalSalesCaseSchema = z.object({
  reason: z.string().min(3).max(2000),
});

export const CorrectPersonalSalesCaseSchema = z.object({
  occurredOn: isoDate,
  title: z.string().trim().min(1).max(500),
  totalAmountYen: z.number().int().positive(),
  note: z.string().trim().max(4000).nullable().optional(),
  allocations: z.array(PersonalSalesAllocationInputSchema).min(1),
  reason: z.string().min(3).max(2000),
});

export const UpsertAllocationRuleDraftSchema = z.object({
  effectiveFrom: isoDate,
  effectiveTo: isoDate.nullable().optional(),
  rulePayload: z.unknown(),
});
