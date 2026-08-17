import { z } from "zod";
import {
  KnowledgeCandidateType,
  KnowledgeFactStatus,
  KnowledgeDomainKeySchema,
} from "./factory-types.js";

export const LLM_EXTRACTOR_TYPE = "llm";
export const LLM_EXTRACTOR_VERSION = "llm-extractor-v1";
export const LLM_PROMPT_VERSION = "kf-extract-v2";
export const HEURISTIC_EXTRACTOR_TYPE = "heuristic";
export const HEURISTIC_EXTRACTOR_VERSION = "heuristic-v1";

export const KnowledgeExtractionEvidenceSchema = z.object({
  sourceChunkId: z.string().min(1),
  excerpt: z.string().min(1).max(2_000),
  startOffset: z.number().int().nonnegative().optional(),
  endOffset: z.number().int().nonnegative().optional(),
});

export const KnowledgeSuggestedRelationsSchema = z.object({
  duplicateOf: z.string().min(1).optional(),
  supersedes: z.string().min(1).optional(),
  conflictsWith: z.string().min(1).optional(),
  relatedTo: z.array(z.string().min(1)).max(8).optional(),
});

export const KnowledgeStructuredCandidateSchema = z.object({
  candidateType: KnowledgeCandidateType,
  factStatus: KnowledgeFactStatus,
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(1_200),
  normalizedStatement: z.string().min(1).max(2_000),
  domains: z.array(z.string().min(1).max(64)).min(1).max(8),
  categories: z.array(z.string().min(1).max(64)).max(8).default([]),
  tags: z.array(z.string().min(1).max(48)).max(16).default([]),
  validFrom: z.string().nullable().optional(),
  validUntil: z.string().nullable().optional(),
  observedAt: z.string().nullable().optional(),
  sourceDate: z.string().nullable().optional(),
  isCurrent: z.boolean(),
  confidence: z.number().min(0).max(1),
  sourceQuality: z.number().min(0).max(1),
  evidence: KnowledgeExtractionEvidenceSchema,
  suggestedRelations: KnowledgeSuggestedRelationsSchema.optional(),
});

export const KnowledgeStructuredExtractionSchema = z.object({
  candidates: z.array(KnowledgeStructuredCandidateSchema).max(8),
  skippedPrivate: z.boolean().optional().default(false),
  notes: z.string().max(500).optional(),
});

export type KnowledgeStructuredCandidate = z.infer<
  typeof KnowledgeStructuredCandidateSchema
>;
export type KnowledgeStructuredExtraction = z.infer<
  typeof KnowledgeStructuredExtractionSchema
>;

export type ExtractionValidationResult =
  | { ok: true; value: KnowledgeStructuredExtraction }
  | { ok: false; reason: "invalid_json" | "schema_failed"; detail: string };

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced?.[1]?.trim() ?? trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("no_json_object");
  }
  return JSON.parse(raw.slice(start, end + 1)) as unknown;
}

/**
 * Strict structured-output validation. Invalid JSON is never patched into success.
 */
export function parseStructuredExtraction(
  text: string,
): ExtractionValidationResult {
  let parsed: unknown;
  try {
    parsed = extractJsonObject(text);
  } catch (err) {
    return {
      ok: false,
      reason: "invalid_json",
      detail: err instanceof Error ? err.message : "invalid_json",
    };
  }
  const result = KnowledgeStructuredExtractionSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      reason: "schema_failed",
      detail: result.error.issues.map((i) => i.path.join(".")).join(",") || "schema",
    };
  }
  const invalidExcerpt = result.data.candidates.find((c) => !c.evidence.excerpt.trim());
  if (invalidExcerpt) {
    return { ok: false, reason: "schema_failed", detail: "excerpt_required" };
  }
  void KnowledgeDomainKeySchema;
  return { ok: true, value: result.data };
}
