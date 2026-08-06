import { InMemoryRepository } from "./in-memory.js";
import type { DatabaseRepositories } from "./repositories.js";
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

export function createInMemoryDatabase(
  seed: Partial<{
    organizations: Organization[];
    projects: Project[];
    tasks: Task[];
    chatThreads: ChatThread[];
    chatMessages: ChatMessage[];
    notifications: Notification[];
    knowledgeDocuments: KnowledgeDocument[];
    researchRuns: ResearchRun[];
    researchJobs: ResearchJob[];
    artifacts: Artifact[];
    artifactJobs: ArtifactJob[];
    auditLogs: AuditLog[];
  }> = {},
): DatabaseRepositories {
  return {
    organizations: new InMemoryRepository(seed.organizations ?? []),
    projects: new InMemoryRepository(seed.projects ?? []),
    tasks: new InMemoryRepository(seed.tasks ?? []),
    chatThreads: new InMemoryRepository(seed.chatThreads ?? []),
    chatMessages: new InMemoryRepository(seed.chatMessages ?? []),
    notifications: new InMemoryRepository(seed.notifications ?? []),
    knowledgeDocuments: new InMemoryRepository(seed.knowledgeDocuments ?? []),
    researchRuns: new InMemoryRepository(seed.researchRuns ?? []),
    researchJobs: new InMemoryRepository(seed.researchJobs ?? []),
    artifacts: new InMemoryRepository(seed.artifacts ?? []),
    artifactJobs: new InMemoryRepository(seed.artifactJobs ?? []),
    auditLogs: new InMemoryRepository(seed.auditLogs ?? []),
  };
}

export const devSampleDatabase = createInMemoryDatabase();
