import { z } from "zod";

export const KnowledgeOriginKind = z.enum([
  "paste",
  "qa",
  "file",
  "url",
  "research",
  "conversation",
  "transcript",
  "api",
  "manual",
  "authoritative_seed",
]);
export type KnowledgeOriginKind = z.infer<typeof KnowledgeOriginKind>;

export const KnowledgeCandidateType = z.enum([
  "fact",
  "policy",
  "procedure",
  "decision",
  "strategy",
  "knowhow",
  "qa",
  "definition",
  "organization",
  "historical_event",
]);
export type KnowledgeCandidateType = z.infer<typeof KnowledgeCandidateType>;

export const KnowledgeFactStatus = z.enum([
  "fact",
  "decision",
  "proposal",
  "hypothesis",
  "rejected",
  "historical",
]);
export type KnowledgeFactStatus = z.infer<typeof KnowledgeFactStatus>;

export const KnowledgeReviewStatus = z.enum([
  "new",
  "duplicate",
  "conflict",
  "possible_update",
  "approved",
  "rejected",
]);
export type KnowledgeReviewStatus = z.infer<typeof KnowledgeReviewStatus>;

export const KnowledgeConflictKind = z.enum([
  "new",
  "duplicate",
  "supersession",
  "conflict",
]);
export type KnowledgeConflictKind = z.infer<typeof KnowledgeConflictKind>;

export const KnowledgeJobStatus = z.enum([
  "pending",
  "processing",
  "completed",
  "failed",
  "cancelled",
  "paused",
]);
export type KnowledgeJobStatus = z.infer<typeof KnowledgeJobStatus>;

export const KnowledgeUnitStatus = z.enum([
  "pending",
  "processing",
  "completed",
  "failed",
  "retryable",
  "waiting_for_extractor",
]);
export type KnowledgeUnitStatus = z.infer<typeof KnowledgeUnitStatus>;

export const KnowledgeEmbeddingStatus = z.enum([
  "pending",
  "ready",
  "failed",
  "skipped",
]);
export type KnowledgeEmbeddingStatus = z.infer<typeof KnowledgeEmbeddingStatus>;

export const DEFAULT_KNOWLEDGE_DOMAINS = [
  { key: "company_common", label: "全社共通" },
  { key: "sales", label: "営業" },
  { key: "telecom", label: "通信" },
  { key: "recruitment", label: "有料職業紹介" },
  { key: "real_estate", label: "不動産" },
  { key: "staffing", label: "人材" },
  { key: "engineering", label: "エンジニアリング" },
  { key: "management", label: "経営" },
] as const;

export type KnowledgeDomainKey = (typeof DEFAULT_KNOWLEDGE_DOMAINS)[number]["key"];

export const KnowledgeDomainKeySchema = z.enum(
  DEFAULT_KNOWLEDGE_DOMAINS.map((d) => d.key) as [
    KnowledgeDomainKey,
    ...KnowledgeDomainKey[],
  ],
);
