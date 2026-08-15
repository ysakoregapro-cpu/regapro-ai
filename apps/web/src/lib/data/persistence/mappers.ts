import type { Visibility } from "@regapro/shared";
import { VisibilitySchema } from "@regapro/shared";
import type {
  StoredMessage,
  StoredThread,
} from "@/lib/application/chat-service";
import { levelFromDb, levelToDb } from "./level-map";

export function parseVisibility(raw: string | null | undefined): Visibility {
  const parsed = VisibilitySchema.safeParse(raw);
  return parsed.success ? parsed.data : "private";
}

export function threadFromRow(row: {
  id: string;
  org_id: string;
  project_id: string | null;
  department_id: string | null;
  title: string;
  confidentiality_level: number;
  visibility: string;
  owner_user_id: string | null;
  security_label_source: string | null;
  minimum_derived_level: number;
  contains_sensitive_content: boolean | null;
  created_at: string;
  updated_at: string;
}): StoredThread {
  return {
    id: row.id,
    title: row.title,
    orgId: row.org_id,
    ownerUserId: row.owner_user_id ?? "",
    departmentId: row.department_id,
    projectId: row.project_id,
    confidentialityLevel: levelFromDb(row.confidentiality_level),
    visibility: parseVisibility(row.visibility),
    securityLabelSource: row.security_label_source ?? "user",
    minimumDerivedLevel: levelFromDb(row.minimum_derived_level),
    containsSensitiveContent: Boolean(row.contains_sensitive_content),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function threadToInsert(thread: StoredThread) {
  return {
    id: thread.id,
    org_id: thread.orgId,
    project_id: thread.projectId,
    department_id: thread.departmentId,
    title: thread.title,
    confidentiality_level: levelToDb(thread.confidentialityLevel),
    visibility: thread.visibility,
    owner_user_id: thread.ownerUserId,
    security_label_source: thread.securityLabelSource,
    minimum_derived_level: levelToDb(thread.minimumDerivedLevel),
    contains_sensitive_content: thread.containsSensitiveContent,
    created_at: thread.createdAt,
    updated_at: thread.updatedAt,
  };
}

export function messageFromRow(row: {
  id: string;
  thread_id: string;
  role: string;
  content: string;
  created_at: string;
  confidentiality_level: number;
  visibility: string;
  classification_confidence: number | null;
  classification_source: string | null;
  sensitivity_signals: unknown;
}): StoredMessage {
  const signals = Array.isArray(row.sensitivity_signals)
    ? (row.sensitivity_signals as string[])
    : undefined;
  return {
    id: row.id,
    threadId: row.thread_id,
    role: row.role as StoredMessage["role"],
    content: row.content,
    createdAt: row.created_at,
    confidentialityLevel: levelFromDb(row.confidentiality_level),
    visibility: parseVisibility(row.visibility),
    classificationConfidence: row.classification_confidence ?? undefined,
    classificationSource: row.classification_source ?? undefined,
    sensitivitySignals: signals,
  };
}

export function messageToInsert(message: StoredMessage, authorId: string) {
  return {
    id: message.id,
    thread_id: message.threadId,
    author_id: authorId,
    role: message.role,
    content: message.content,
    created_at: message.createdAt,
    confidentiality_level: levelToDb(message.confidentialityLevel),
    visibility: message.visibility,
    classification_confidence: message.classificationConfidence ?? null,
    classification_source: message.classificationSource ?? null,
    sensitivity_signals: message.sensitivitySignals ?? [],
  };
}
