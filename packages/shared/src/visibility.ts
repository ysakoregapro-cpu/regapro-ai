import { z } from "zod";
import {
  CONFIDENTIALITY_LEVELS,
  ConfidentialityLevelSchema,
  type ConfidentialityLevel,
} from "./confidentiality.js";

/** Who can access a resource — independent from ConfidentialityLevel. */
export const VISIBILITY_LEVELS = [
  "private",
  "participants",
  "project",
  "department",
  "organization",
  "restricted",
] as const;

export type Visibility = (typeof VISIBILITY_LEVELS)[number];

export const VisibilitySchema = z.enum(VISIBILITY_LEVELS);

/** @deprecated Prefer VISIBILITY_LEVELS; kept for gradual migration from "team". */
export function normalizeVisibility(value: string): Visibility {
  if (value === "team") return "participants";
  if ((VISIBILITY_LEVELS as readonly string[]).includes(value)) {
    return value as Visibility;
  }
  return "private";
}

export const SecurityLabelSchema = z.object({
  confidentialityLevel: ConfidentialityLevelSchema,
  visibility: VisibilitySchema,
  ownerUserId: z.string().min(1).optional(),
  departmentId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  originThreadId: z.string().nullable().optional(),
  originMessageId: z.string().nullable().optional(),
  securityLabelSource: z
    .enum(["user", "inherited", "classified", "extracted", "system"])
    .optional(),
  minimumDerivedLevel: ConfidentialityLevelSchema.optional(),
});

export type SecurityLabel = z.infer<typeof SecurityLabelSchema>;

export function inheritSecurityLabel(
  parent: Pick<
    SecurityLabel,
    "confidentialityLevel" | "visibility" | "ownerUserId" | "departmentId" | "projectId"
  >,
  opts?: {
    originThreadId?: string | null;
    originMessageId?: string | null;
    raiseTo?: ConfidentialityLevel;
  },
): SecurityLabel {
  const level = opts?.raiseTo
    ? CONFIDENTIALITY_LEVELS[
        Math.max(
          CONFIDENTIALITY_LEVELS.indexOf(parent.confidentialityLevel),
          CONFIDENTIALITY_LEVELS.indexOf(opts.raiseTo),
        )
      ]!
    : parent.confidentialityLevel;

  return {
    confidentialityLevel: level,
    visibility: parent.visibility,
    ownerUserId: parent.ownerUserId,
    departmentId: parent.departmentId ?? null,
    projectId: parent.projectId ?? null,
    originThreadId: opts?.originThreadId ?? null,
    originMessageId: opts?.originMessageId ?? null,
    securityLabelSource: "inherited",
    minimumDerivedLevel: level,
  };
}
