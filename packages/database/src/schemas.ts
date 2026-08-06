import { z } from "zod";

export const UuidSchema = z.string().uuid();
export const TimestampSchema = z.string().datetime({ offset: true });
export const SoftDeleteSchema = z.object({
  deletedAt: TimestampSchema.nullable().optional(),
});

export const VisibilitySchema = z.enum([
  "private",
  "participants",
  "project",
  "department",
  "organization",
  "restricted",
]);

export const ConfidentialityLevelIntSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);

export const ConfidentialityKeySchema = z.enum([
  "company",
  "people",
  "executive",
]);

export const OrganizationSchema = z
  .object({
    id: UuidSchema,
    name: z.string().min(1),
    slug: z.string().min(1),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .merge(SoftDeleteSchema);

export type Organization = z.infer<typeof OrganizationSchema>;

export const DepartmentSchema = z
  .object({
    id: UuidSchema,
    orgId: UuidSchema,
    name: z.string().min(1),
    key: z.enum(["sales", "people", "executive_strategy"]).nullable().optional(),
    defaultClearanceLevel: ConfidentialityLevelIntSchema.default(1),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .merge(SoftDeleteSchema);

export type Department = z.infer<typeof DepartmentSchema>;

export const ProfileSchema = z
  .object({
    id: UuidSchema,
    userId: UuidSchema,
    displayName: z.string().min(1),
    avatarUrl: z.string().url().nullable().optional(),
    locale: z.string().default("ja-JP"),
    timezone: z.string().default("Asia/Tokyo"),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .merge(SoftDeleteSchema);

export type Profile = z.infer<typeof ProfileSchema>;

export const ProjectSchema = z
  .object({
    id: UuidSchema,
    orgId: UuidSchema,
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    visibility: VisibilitySchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .merge(SoftDeleteSchema);

export type Project = z.infer<typeof ProjectSchema>;

export const ChatThreadSchema = z
  .object({
    id: UuidSchema,
    orgId: UuidSchema,
    projectId: UuidSchema.nullable().optional(),
    departmentId: UuidSchema.nullable().optional(),
    title: z.string().min(1),
    confidentialityLevel: ConfidentialityKeySchema.default("company"),
    visibility: VisibilitySchema.default("private"),
    ownerUserId: UuidSchema,
    securityLabelSource: z.string().default("user"),
    minimumDerivedLevel: ConfidentialityKeySchema.default("company"),
    containsSensitiveContent: z.boolean().default(false),
    classificationReviewedAt: TimestampSchema.nullable().optional(),
    classificationReviewedBy: UuidSchema.nullable().optional(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .merge(SoftDeleteSchema);

export type ChatThread = z.infer<typeof ChatThreadSchema>;

export const ChatMessageSchema = z
  .object({
    id: UuidSchema,
    threadId: UuidSchema,
    authorId: UuidSchema,
    content: z.string(),
    role: z.enum(["user", "assistant", "system"]),
    createdAt: TimestampSchema,
  })
  .merge(SoftDeleteSchema);

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const TaskStatusSchema = z.enum([
  "draft",
  "open",
  "in_progress",
  "blocked",
  "completed",
  "cancelled",
]);

export const TaskSchema = z
  .object({
    id: UuidSchema,
    orgId: UuidSchema,
    projectId: UuidSchema.nullable().optional(),
    title: z.string().min(1),
    description: z.string().nullable().optional(),
    status: TaskStatusSchema,
    assigneeId: UuidSchema.nullable().optional(),
    dueAt: TimestampSchema.nullable().optional(),
    createdBy: UuidSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .merge(SoftDeleteSchema);

export type Task = z.infer<typeof TaskSchema>;

export const NotificationChannelSchema = z.enum(["in_app", "push", "email"]);
export const NotificationStatusSchema = z.enum([
  "pending",
  "claimed",
  "delivered",
  "failed",
  "cancelled",
]);

export const NotificationSchema = z
  .object({
    id: UuidSchema,
    orgId: UuidSchema,
    userId: UuidSchema,
    type: z.string().min(1),
    title: z.string().min(1),
    body: z.string(),
    status: NotificationStatusSchema,
    metadata: z.record(z.unknown()).optional(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .merge(SoftDeleteSchema);

export type Notification = z.infer<typeof NotificationSchema>;

export const KnowledgeDocumentStatusSchema = z.enum([
  "draft",
  "review",
  "approved",
  "published",
  "superseded",
  "expired",
  "archived",
]);

export const KnowledgeDocumentSchema = z
  .object({
    id: UuidSchema,
    orgId: UuidSchema,
    sourceId: UuidSchema,
    title: z.string().min(1),
    status: KnowledgeDocumentStatusSchema,
    contentHash: z.string().min(1),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .merge(SoftDeleteSchema);

export type KnowledgeDocument = z.infer<typeof KnowledgeDocumentSchema>;

export const ResearchRunStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const ResearchRunSchema = z
  .object({
    id: UuidSchema,
    orgId: UuidSchema,
    projectId: UuidSchema.nullable().optional(),
    query: z.string().min(1),
    status: ResearchRunStatusSchema,
    budgetTokens: z.number().int().positive(),
    tokensUsed: z.number().int().nonnegative().default(0),
    createdBy: UuidSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .merge(SoftDeleteSchema);

export type ResearchRun = z.infer<typeof ResearchRunSchema>;

export const ResearchJobSchema = z
  .object({
    id: UuidSchema,
    runId: UuidSchema,
    orgId: UuidSchema,
    stage: z.string().min(1),
    status: z.enum(["pending", "claimed", "completed", "failed", "retry"]),
    attempts: z.number().int().nonnegative(),
    maxAttempts: z.number().int().positive(),
    lastError: z.string().nullable().optional(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .merge(SoftDeleteSchema);

export type ResearchJob = z.infer<typeof ResearchJobSchema>;

export const ArtifactSchema = z
  .object({
    id: UuidSchema,
    orgId: UuidSchema,
    projectId: UuidSchema.nullable().optional(),
    title: z.string().min(1),
    format: z.enum(["markdown", "pdf", "docx", "xlsx", "pptx"]),
    createdBy: UuidSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .merge(SoftDeleteSchema);

export type Artifact = z.infer<typeof ArtifactSchema>;

export const ArtifactJobSchema = z
  .object({
    id: UuidSchema,
    artifactId: UuidSchema,
    orgId: UuidSchema,
    status: z.enum(["pending", "claimed", "completed", "failed", "retry"]),
    attempts: z.number().int().nonnegative(),
    maxAttempts: z.number().int().positive(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .merge(SoftDeleteSchema);

export type ArtifactJob = z.infer<typeof ArtifactJobSchema>;

export const AuditLogSchema = z.object({
  id: UuidSchema,
  orgId: UuidSchema,
  actorId: UuidSchema.nullable().optional(),
  action: z.string().min(1),
  resourceType: z.string().min(1),
  resourceId: UuidSchema.nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
  createdAt: TimestampSchema,
});

export type AuditLog = z.infer<typeof AuditLogSchema>;
