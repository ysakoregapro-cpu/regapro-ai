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

export type ModelGenerateInput = {
  access: AccessContext;
  userText: string;
  context: AIContext;
  plan: RetrievalPlan;
  intent: IntentDecision;
  hints?: WorkflowAnswerHints;
};

export type ModelGenerateOutput = {
  text: string;
  confidence: number;
  providerId: ModelProviderId;
  modelId: string;
  connected: boolean;
  limitations: string[];
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
  }): AnswerResult;
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
  onTrace?: (trace: {
    intent: AnswerIntent;
    retrievalTypes: Array<"internal" | "web" | "research">;
    retrievedCount: number;
    modelProvider: ModelProviderId;
    latencyMs: number;
    failureStage: string | null;
  }) => void;
};

export type RunAnswerPipelineInput = {
  request: RequestContext;
  hints?: WorkflowAnswerHints;
};
