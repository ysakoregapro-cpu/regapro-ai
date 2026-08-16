import type { PipelineTrace } from "./types.js";

/**
 * In-process diagnostic ring. Counts and flags only — never message bodies,
 * secrets, or confidential excerpts.
 */
export type AnswerDiagnosticEvent = {
  at: string;
  intent: string;
  needInternal: boolean;
  needWeb: boolean;
  needDeepResearch: boolean;
  internalCount: number;
  webCount: number;
  researchCount: number;
  contextCount: number;
  citationCount: number;
  citationPersistCount: number;
  sanitizedQueryCount: number;
  pagesFetched: number;
  modelRole: string | null;
  modelId: string | null;
  modelProvider: string;
  success: boolean;
  failureStage: string | null;
};

const RING = 20;
const events: AnswerDiagnosticEvent[] = [];

const EMPTY: Omit<AnswerDiagnosticEvent, "at"> = {
  intent: "general",
  needInternal: false,
  needWeb: false,
  needDeepResearch: false,
  internalCount: 0,
  webCount: 0,
  researchCount: 0,
  contextCount: 0,
  citationCount: 0,
  citationPersistCount: 0,
  sanitizedQueryCount: 0,
  pagesFetched: 0,
  modelRole: null,
  modelId: null,
  modelProvider: "honest-fallback",
  success: false,
  failureStage: null,
};

export function recordAnswerDiagnostic(
  event: Partial<AnswerDiagnosticEvent> & Pick<AnswerDiagnosticEvent, "intent">,
): AnswerDiagnosticEvent {
  const full: AnswerDiagnosticEvent = {
    ...EMPTY,
    ...event,
    at: new Date().toISOString(),
  };
  events.unshift(full);
  if (events.length > RING) events.pop();
  return full;
}

export function listAnswerDiagnostics(): AnswerDiagnosticEvent[] {
  return [...events];
}

export function diagnosticFromTrace(
  trace: PipelineTrace,
  extras?: Partial<AnswerDiagnosticEvent>,
): Omit<AnswerDiagnosticEvent, "at"> {
  return {
    intent: trace.intent,
    needInternal: trace.needInternal ?? false,
    needWeb: trace.needWeb ?? false,
    needDeepResearch: trace.needDeepResearch ?? false,
    internalCount: trace.internalCount ?? 0,
    webCount: trace.webCount ?? 0,
    researchCount: trace.researchCount ?? 0,
    contextCount: trace.contextCount ?? 0,
    citationCount: trace.citationCount ?? 0,
    citationPersistCount: extras?.citationPersistCount ?? 0,
    sanitizedQueryCount: trace.sanitizedQueryCount ?? 0,
    pagesFetched: trace.pagesFetched ?? 0,
    modelRole: trace.selectedModelRole ?? null,
    modelId: trace.actualModelId ?? null,
    modelProvider: trace.modelProvider,
    success: trace.success !== false && !trace.failureStage,
    failureStage: trace.failureStage,
  };
}
