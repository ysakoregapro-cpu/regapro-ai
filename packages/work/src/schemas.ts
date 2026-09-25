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
