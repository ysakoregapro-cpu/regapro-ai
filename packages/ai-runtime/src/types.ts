import type { AccessContext } from "@regapro/security";
import type { ConfidentialityLevel, Visibility } from "@regapro/shared";

/** Request intents the runtime can route. Workflow types map into these. */
export type AnswerIntent =
  | "general"
  | "internal_knowledge"
  | "web_search"
  | "deep_research"
  | "task"
  | "document"
  | "file_review"
  | "code";

export type SourceType =
  | "knowledge"
  | "knowledge_chunk"
  | "web"
  | "research"
  | "file"
  | "conversation"
  | "project"
  | "department";

export type RequestContext = {
  organizationId: string;
  userId: string;
  threadId: string;
  messageId: string | null;
  userText: string;
  /** Thread-scoped AccessContext — required for all retrieval. */
  access: AccessContext;
  workflowHint?: AnswerIntent | null;
  projectId?: string | null;
  /** Never use audit Case path for normal answers. */
  allowAuditBypass: false;
};

export type IntentDecision = {
  intent: AnswerIntent;
  confidence: number;
  reason: string;
  provider: "rules" | "local_llm" | "server_llm";
};

export type RetrievalPlan = {
  intent: AnswerIntent;
  needInternalKnowledge: boolean;
  needWeb: boolean;
  needDeepResearch: boolean;
  needProjectContext: boolean;
  needDepartmentContext: boolean;
  needCitations: boolean;
  needToolExecution: boolean;
  /**
   * Private conversations must not feed normal Knowledge Retrieval.
   * Always false for standard AI answers.
   */
  includePrivateConversations: false;
  /** conversation:audit must never mix into normal answers. */
  includeAuditCases: false;
};

export type RetrievedItem = {
  id: string;
  content: string;
  title: string;
  sourceType: SourceType;
  sourceId: string;
  sourceUri: string | null;
  confidentialityLevel: ConfidentialityLevel;
  visibility: Visibility;
  ownerUserId?: string;
  relevance: number;
  freshness: string | null;
  excerpt: string;
};

export type Citation = {
  id: string;
  title: string;
  sourceType: SourceType;
  sourceId: string;
  uri: string | null;
  excerpt: string;
  confidentialityLevel: ConfidentialityLevel;
  relevance: number;
};

export type AIContextItem = {
  id: string;
  content: string;
  source: string;
  sourceType: SourceType;
  confidentialityLevel: ConfidentialityLevel;
  citation: Citation;
  freshness: string | null;
  relevance: number;
};

export type AIContext = {
  items: AIContextItem[];
  ceiling: ConfidentialityLevel;
  rejectedCount: number;
  /** Hook for future token budget / reranker. */
  budgetHints: {
    maxItems: number;
    maxChars: number;
  };
};

export type ModelProviderId =
  | "honest-fallback"
  | "browser-local"
  | "server-llm"
  | "rules-template";

export type AnswerResult = {
  text: string;
  citations: Citation[];
  usedInternalKnowledge: boolean;
  usedWeb: boolean;
  model: {
    providerId: ModelProviderId;
    modelId: string;
    connected: boolean;
  };
  retrievalPlan: RetrievalPlan;
  intent: IntentDecision;
  confidence: number;
  limitations: string[];
  generatedAt: string;
};

export type PipelineTrace = {
  intent: AnswerIntent;
  retrievalTypes: Array<"internal" | "web" | "research">;
  retrievedCount: number;
  modelProvider: ModelProviderId;
  latencyMs: number;
  failureStage: string | null;
};

export type WorkflowAnswerHints = {
  researchSummary?: string | null;
  artifactSummary?: string | null;
  taskSummary?: string | null;
};
