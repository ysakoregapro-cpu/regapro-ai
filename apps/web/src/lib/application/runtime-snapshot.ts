import { listAnswerDiagnostics } from "@regapro/ai-runtime";

/** Counts and provider ids only — never secrets or Knowledge bodies. */
export type SafeRuntimeSnapshot = {
  modelProvider: string;
  modelId: string | null;
  modelRole: string | null;
  fallbackReason: string | null;
  providerRequestResult: "ok" | "fallback" | "failed";
  modelConnected: boolean;
  internalCount: number;
  webCount: number;
  researchCount: number;
  pagesFetched: number;
  sanitizedQueryCount: number;
  browserSessions: number;
};

export function lastSafeRuntimeSnapshot(): SafeRuntimeSnapshot | null {
  const d = listAnswerDiagnostics()[0];
  if (!d) return null;
  return {
    modelProvider: d.modelProvider,
    modelId: d.modelId,
    modelRole: d.modelRole,
    fallbackReason: d.fallbackReason,
    providerRequestResult: d.providerRequestResult,
    modelConnected: d.modelConnected,
    internalCount: d.internalCount,
    webCount: d.webCount,
    researchCount: d.researchCount,
    pagesFetched: d.pagesFetched,
    sanitizedQueryCount: d.sanitizedQueryCount,
    browserSessions: d.browserSessions,
  };
}
