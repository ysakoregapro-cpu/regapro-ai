/**
 * Safe runtime telemetry — no message bodies, secrets, or PII payloads.
 * Quiet by default; pass a sink to observe.
 */
export type AnswerRuntimeEvent = {
  at: string;
  intent: string;
  retrievalTypes: string[];
  retrievedCount: number;
  modelProvider: string;
  latencyMs: number;
  failureStage: string | null;
};

export function createAnswerRuntimeLogger(sink?: (e: AnswerRuntimeEvent) => void) {
  return {
    emit(event: Omit<AnswerRuntimeEvent, "at">) {
      const payload: AnswerRuntimeEvent = {
        at: new Date().toISOString(),
        ...event,
      };
      sink?.(payload);
    },
  };
}
