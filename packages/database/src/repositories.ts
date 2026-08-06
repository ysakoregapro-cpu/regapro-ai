import type {
  Artifact,
  ArtifactJob,
  AuditLog,
  ChatMessage,
  ChatThread,
  KnowledgeDocument,
  Notification,
  Organization,
  Project,
  ResearchJob,
  ResearchRun,
  Task,
} from "./schemas.js";

export interface Repository<T> {
  findById(id: string): Promise<T | null>;
  list(): Promise<T[]>;
  create(entity: T): Promise<T>;
  update(id: string, patch: Partial<T>): Promise<T | null>;
  softDelete(id: string): Promise<boolean>;
}

export type OrganizationRepository = Repository<Organization>;
export type ProjectRepository = Repository<Project>;
export type TaskRepository = Repository<Task>;
export type ChatThreadRepository = Repository<ChatThread>;
export type ChatMessageRepository = Repository<ChatMessage>;
export type NotificationRepository = Repository<Notification>;
export type KnowledgeDocumentRepository = Repository<KnowledgeDocument>;
export type ResearchRunRepository = Repository<ResearchRun>;
export type ResearchJobRepository = Repository<ResearchJob>;
export type ArtifactRepository = Repository<Artifact>;
export type ArtifactJobRepository = Repository<ArtifactJob>;
export type AuditLogRepository = Repository<AuditLog>;

export interface DatabaseRepositories {
  organizations: OrganizationRepository;
  projects: ProjectRepository;
  tasks: TaskRepository;
  chatThreads: ChatThreadRepository;
  chatMessages: ChatMessageRepository;
  notifications: NotificationRepository;
  knowledgeDocuments: KnowledgeDocumentRepository;
  researchRuns: ResearchRunRepository;
  researchJobs: ResearchJobRepository;
  artifacts: ArtifactRepository;
  artifactJobs: ArtifactJobRepository;
  auditLogs: AuditLogRepository;
}
