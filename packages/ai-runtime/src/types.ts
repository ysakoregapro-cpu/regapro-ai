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
  /** Present when the utterance is a coding request. */
  codingMode?: "pasted" | "workspace" | "vibe" | null;
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
  /** When false, current published facts are preferred over historical. */
  includeHistoricalKnowledge?: boolean;
  /** Optional domain keys the planner prefers (data-driven catalog). */
  preferredDomainKeys?: string[];
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
  domain?: string | null;
  publishedAt?: string | null;
  retrievedAt?: string | null;
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
  provenance: "internal" | "web";
  domain?: string | null;
  retrievedAt?: string | null;
  publishedAt?: string | null;
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
  | "rules-template"
  | "vercel-gateway"
  | "self-hosted";

export type ModelRole = "fast" | "main" | "reasoning" | "code" | "vision";

export type ModelUsageMetadata = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type AnswerResult = {
  text: string;
  citations: Citation[];
  usedInternalKnowledge: boolean;
  usedWeb: boolean;
  model: {
    providerId: ModelProviderId;
    modelId: string;
    connected: boolean;
    role?: ModelRole | null;
    fallbackCount?: number;
    usage?: ModelUsageMetadata | null;
    estimatedCostUsd?: number | null;
  };
  retrievalPlan: RetrievalPlan;
  intent: IntentDecision;
  confidence: number;
  limitations: string[];
  generatedAt: string;
  retrieval: {
    internalCount: number;
    webCount: number;
    researchCount: number;
    contextCount: number;
    citationCount: number;
    sanitizedQueryCount: number;
    pagesFetched: number;
    browserSessions?: number;
  };
  coding?: {
    runId: string;
    mode: "pasted" | "workspace" | "vibe";
    status: string;
    deviceLabel: string | null;
    workspaceLabel: string | null;
    currentStep: string;
    toolNames: string[];
    changedFiles: string[];
    diffPreview: string | null;
    pendingApproval: boolean;
    verificationSummary: string | null;
  } | null;
};

export type PipelineTrace = {
  intent: AnswerIntent;
  retrievalTypes: Array<"internal" | "web" | "research">;
  retrievedCount: number;
  modelProvider: ModelProviderId;
  selectedModelRole?: ModelRole | null;
  actualModelId?: string;
  fallbackCount?: number;
  webProvider?: string | null;
  tokenUsage?: ModelUsageMetadata | null;
  estimatedCostUsd?: number | null;
  latencyMs: number;
  failureStage: string | null;
  success?: boolean;
  internalCount?: number;
  webCount?: number;
  researchCount?: number;
  contextCount?: number;
  citationCount?: number;
  sanitizedQueryCount?: number;
  pagesFetched?: number;
  browserSessions?: number;
  needInternal?: boolean;
  needWeb?: boolean;
  needDeepResearch?: boolean;
  fallbackReason?: string | null;
  providerRequestResult?: "ok" | "fallback" | "failed";
  modelConnected?: boolean;
};

export type WorkflowAnswerHints = {
  researchSummary?: string | null;
  artifactSummary?: string | null;
  taskSummary?: string | null;
  codingSummary?: string | null;
};
