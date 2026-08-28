import type { AccessContext } from "@regapro/security";
import type {
  AnswerIntent,
  AnswerResult,
  AIContext,
  IntentDecision,
  ModelProviderId,
  RetrievedItem,
  RetrievalPlan,
  RequestContext,
  WorkflowAnswerHints,
} from "./types.js";

export type IntentRouter = {
  route(input: {
    text: string;
    workflowHint?: AnswerIntent | null;
  }): Promise<IntentDecision>;
};

export type RetrievalPlanner = {
  plan(input: {
    intent: IntentDecision;
    access: AccessContext;
    text?: string;
  }): RetrievalPlan;
};

/**
 * Security rule: every retrieve() MUST receive AccessContext.
 * Implementations filter BEFORE returning content — never fetch-all-then-mask.
 */
export type InternalKnowledgeRetriever = {
  readonly id: string;
  retrieve(input: {
    access: AccessContext;
    plan: RetrievalPlan;
    query: string;
  }): Promise<RetrievedItem[]>;
};

export type WebRetriever = {
  readonly id: string;
  readonly connected: boolean;
  retrieve(input: {
    access: AccessContext;
    plan: RetrievalPlan;
    query: string;
  }): Promise<RetrievedItem[]>;
};

export type ResearchRetriever = {
  readonly id: string;
  readonly connected: boolean;
  retrieve(input: {
    access: AccessContext;
    plan: RetrievalPlan;
    query: string;
  }): Promise<RetrievedItem[]>;
};

export type ContextBuilder = {
  build(input: {
    access: AccessContext;
    items: RetrievedItem[];
    maxItems?: number;
    maxChars?: number;
  }): AIContext;
};

export type ModelToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ModelConversationMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
};

export type ModelGenerateInput = {
  access: AccessContext;
  userText: string;
  context: AIContext;
  plan: RetrievalPlan;
  intent: IntentDecision;
  hints?: WorkflowAnswerHints;
  role?: import("./types.js").ModelRole | null;
  /** Knowledge Factory structured extraction. Does not change answer routing. */
  task?: "answer" | "knowledge_extraction";
  systemOverride?: string;
  tools?: ModelToolDefinition[];
  conversation?: ModelConversationMessage[];
};

export type ModelGenerateOutput = {
  text: string;
  confidence: number;
  providerId: ModelProviderId;
  modelId: string;
  connected: boolean;
  limitations: string[];
  role?: import("./types.js").ModelRole | null;
  fallbackCount?: number;
  usage?: import("./types.js").ModelUsageMetadata | null;
  estimatedCostUsd?: number | null;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
};

export type ModelProvider = {
  readonly id: ModelProviderId;
  readonly connected: boolean;
  generate(input: ModelGenerateInput): Promise<ModelGenerateOutput>;
};

export type AnswerComposer = {
  compose(input: {
    model: ModelGenerateOutput;
    context: AIContext;
    plan: RetrievalPlan;
    intent: IntentDecision;
    coding?: NonNullable<AnswerResult["coding"]> | null;
  }): AnswerResult;
};

export type CodingRuntimeResult = {
  text: string;
  modelId: string;
  role?: import("./types.js").ModelRole | null;
  usage?: import("./types.js").ModelUsageMetadata | null;
  estimatedCostUsd?: number | null;
  limitations: string[];
  coding: NonNullable<import("./types.js").AnswerResult["coding"]>;
};

export type CodingRuntimePort = {
  run(input: {
    access: AccessContext;
    threadId: string | null;
    userText: string;
    knowledge: Array<{ title: string; excerpt: string }>;
  }): Promise<CodingRuntimeResult>;
};

export type AnswerPipelineDeps = {
  intentRouter: IntentRouter;
  retrievalPlanner: RetrievalPlanner;
  internalKnowledge: InternalKnowledgeRetriever;
  web: WebRetriever;
  research: ResearchRetriever;
  contextBuilder: ContextBuilder;
  model: ModelProvider;
  answerComposer: AnswerComposer;
  codingRuntime?: CodingRuntimePort;
  onTrace?: (trace: import("./types.js").PipelineTrace) => void;
};

export type RunAnswerPipelineInput = {
  request: RequestContext;
  hints?: WorkflowAnswerHints;
};
