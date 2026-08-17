import { z } from "zod";
import {
  ConfidentialityLevelSchema,
  VisibilitySchema,
  type ConfidentialityLevel,
  type Visibility,
} from "@regapro/shared";
import {
  KnowledgeCandidateType,
  KnowledgeDomainKeySchema,
  KnowledgeFactStatus,
  type KnowledgeCandidateType as CandidateType,
  type KnowledgeDomainKey,
  type KnowledgeFactStatus as FactStatus,
} from "./factory-types.js";

export const KnowledgeImportModeSchema = z.enum(["structured", "source", "qa"]);
export type KnowledgeImportMode = z.infer<typeof KnowledgeImportModeSchema>;

const ClearanceInputSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal("1"),
  z.literal("2"),
  z.literal("3"),
  ConfidentialityLevelSchema,
]);

export function parseClearanceLevel(value: z.infer<typeof ClearanceInputSchema>): ConfidentialityLevel {
  if (value === 1 || value === "1") return "company";
  if (value === 2 || value === "2") return "people";
  if (value === 3 || value === "3") return "executive";
  return value;
}

/**
 * Domain is retrieval targeting. Clearance is who may see the fact.
 * There is no mapping from domain → clearance.
 */
export function inferredClearanceForDomain(_domain: KnowledgeDomainKey): null {
  return null;
}

const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "sourceDate must be YYYY-MM-DD");

export const KnowledgeImportItemSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[a-zA-Z0-9._-]+$/, "id must be slug-like (letters, digits, . _ -)"),
    title: z.string().min(1).max(200),
    file: z.string().min(1).max(500).optional(),
    content: z.string().min(1).max(2_000_000).optional(),
    importMode: KnowledgeImportModeSchema,
    domains: z.array(KnowledgeDomainKeySchema).min(1).max(8),
    clearanceLevel: ClearanceInputSchema,
    visibility: VisibilitySchema,
    departmentId: z.string().uuid().optional(),
    projectId: z.string().uuid().optional(),
    departmentKey: z.string().min(1).max(64).optional(),
    candidateType: KnowledgeCandidateType.optional(),
    factStatus: KnowledgeFactStatus.optional(),
    isCurrent: z.boolean().optional().default(true),
    sourceDate: IsoDateSchema.optional(),
    validFrom: IsoDateSchema.optional(),
    validUntil: IsoDateSchema.optional(),
    sourceQuality: z.number().min(0).max(1).optional(),
    tags: z.array(z.string().min(1).max(48)).max(16).optional().default([]),
    authoritativeSeed: z.boolean().optional().default(false),
    question: z.string().min(1).max(4000).optional(),
    answer: z.string().min(1).max(20_000).optional(),
    expertName: z.string().min(1).max(120).optional(),
  })
  .strict()
  .superRefine((item, ctx) => {
    if (!item.file && !item.content) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "each item needs file or content",
        path: ["file"],
      });
    }
    if (item.importMode === "qa") {
      if (!item.question || !item.answer) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "qa mode requires question and answer",
          path: ["question"],
        });
      }
    }
  });

export const KnowledgeImportManifestSchema = z
  .object({
    version: z.literal(1),
    items: z.array(KnowledgeImportItemSchema).min(1).max(500),
  })
  .strict();

export type KnowledgeImportItem = z.infer<typeof KnowledgeImportItemSchema>;
export type KnowledgeImportManifest = z.infer<typeof KnowledgeImportManifestSchema>;

export type ManifestValidationFailure = {
  path: string;
  message: string;
  code: string;
};

export type ParseManifestResult =
  | { ok: true; manifest: KnowledgeImportManifest }
  | { ok: false; failures: ManifestValidationFailure[] };

export function parseKnowledgeImportManifest(raw: unknown): ParseManifestResult {
  const parsed = KnowledgeImportManifestSchema.safeParse(raw);
  if (parsed.success) {
    const ids = parsed.data.items.map((i) => i.id);
    const dup = ids.filter((id, idx) => ids.indexOf(id) !== idx);
    if (dup.length) {
      return {
        ok: false,
        failures: [...new Set(dup)].map((id) => ({
          path: `items.id:${id}`,
          message: "duplicate manifest item id",
          code: "duplicate_item_id",
        })),
      };
    }
    return { ok: true, manifest: parsed.data };
  }
  return {
    ok: false,
    failures: parsed.error.issues.map((issue) => ({
      path: issue.path.join(".") || "(root)",
      message: issue.message,
      code: issue.code,
    })),
  };
}

export type ResolvedImportItem = {
  id: string;
  title: string;
  importMode: KnowledgeImportMode;
  domains: KnowledgeDomainKey[];
  clearanceLevel: ConfidentialityLevel;
  visibility: Visibility;
  departmentId: string | null;
  projectId: string | null;
  candidateType: CandidateType;
  factStatus: FactStatus;
  isCurrent: boolean;
  sourceDate: string | null;
  validFrom: string | null;
  validUntil: string | null;
  sourceQuality: number | null;
  tags: string[];
  authoritativeSeed: boolean;
  question: string | null;
  answer: string | null;
  expertName: string | null;
  file: string | null;
  content: string;
  contentHash: string;
  checksum: string;
  charCount: number;
};

export type ResolveImportFailure = ManifestValidationFailure & { itemId?: string };

function defaultCandidateType(item: KnowledgeImportItem): CandidateType {
  if (item.candidateType) return item.candidateType;
  if (item.importMode === "qa") return "qa";
  if (item.authoritativeSeed) return "policy";
  return "knowhow";
}

function defaultFactStatus(item: KnowledgeImportItem): FactStatus {
  if (item.factStatus) return item.factStatus;
  if (item.isCurrent === false) return "historical";
  return "fact";
}

export function resolveKnowledgeImportItems(input: {
  manifest: KnowledgeImportManifest;
  files: Map<string, string>;
  hash: (text: string) => string;
}): { items: ResolvedImportItem[]; failures: ResolveImportFailure[] } {
  const items: ResolvedImportItem[] = [];
  const failures: ResolveImportFailure[] = [];
  for (const item of input.manifest.items) {
    let content = item.content ?? "";
    if (item.file) {
      const normalized = item.file.replace(/\\/g, "/");
      if (
        normalized.includes("..") ||
        normalized.startsWith("/") ||
        /^[a-zA-Z]:/.test(item.file)
      ) {
        failures.push({
          itemId: item.id,
          path: `items.${item.id}.file`,
          message: "file path must be relative to the import directory",
          code: "path_escape",
        });
        continue;
      }
      const fromFile = input.files.get(item.file) ?? input.files.get(normalized);
      if (fromFile == null) {
        failures.push({
          itemId: item.id,
          path: `items.${item.id}.file`,
          message: `file not found: ${item.file}`,
          code: "missing_file",
        });
        continue;
      }
      content = fromFile;
    }
    if (!content.trim()) {
      failures.push({
        itemId: item.id,
        path: `items.${item.id}.content`,
        message: "empty content",
        code: "empty_content",
      });
      continue;
    }
    if (item.importMode === "qa" && item.question && item.answer) {
      content = `Q: ${item.question}\n\nA: ${item.answer}${
        item.expertName ? `\n\n専門家: ${item.expertName}` : ""
      }`;
    }
    const clearanceLevel = parseClearanceLevel(item.clearanceLevel);
    const contentHash = input.hash(content);
    items.push({
      id: item.id,
      title: item.title,
      importMode: item.importMode,
      domains: item.domains,
      clearanceLevel,
      visibility: item.visibility,
      departmentId: item.departmentId ?? null,
      projectId: item.projectId ?? null,
      candidateType: defaultCandidateType(item),
      factStatus: defaultFactStatus(item),
      isCurrent: item.isCurrent ?? true,
      sourceDate: item.sourceDate ?? null,
      validFrom: item.validFrom ?? null,
      validUntil: item.validUntil ?? null,
      sourceQuality: item.sourceQuality ?? null,
      tags: item.tags ?? [],
      authoritativeSeed: item.authoritativeSeed ?? false,
      question: item.question ?? null,
      answer: item.answer ?? null,
      expertName: item.expertName ?? null,
      file: item.file ?? null,
      content,
      contentHash,
      checksum: contentHash,
      charCount: content.length,
    });
  }
  return { items, failures };
}

export function clearanceRankLabel(level: ConfidentialityLevel): "L1" | "L2" | "L3" {
  if (level === "company") return "L1";
  if (level === "people") return "L2";
  return "L3";
}
