import type { ConfidentialityLevel } from "@regapro/shared";
import { scrubSecrets } from "./secrets.js";

export type RuntimeTraceRecord = {
  name: string;
  requestId?: string;
  intent?: string;
  workflow?: string;
  selectedModelRole?: string | null;
  actualModelId?: string;
  providerRoute?: string;
  fallbackCount?: number;
  retrievalCounts?: {
    internal: number;
    web: number;
    research: number;
    context?: number;
    citations?: number;
    sanitizedQueries?: number;
    pagesFetched?: number;
  };
  webProvider?: string | null;
  latencyMs?: number;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
  estimatedCostUsd?: number | null;
  success: boolean;
  evaluationTags?: string[];
  confidentialityLevel: ConfidentialityLevel;
  input?: unknown;
  output?: unknown;
};

function isElevated(level: ConfidentialityLevel): boolean {
  return level === "people" || level === "executive";
}

export function buildSafeTracePayload(record: RuntimeTraceRecord): {
  metadata: Record<string, unknown>;
  input?: unknown;
  output?: unknown;
  metadataOnly: boolean;
} {
  const metadataOnly = isElevated(record.confidentialityLevel);
  const metadata = scrubSecrets({
    requestId: record.requestId ?? null,
    intent: record.intent ?? null,
    workflow: record.workflow ?? null,
    selectedModelRole: record.selectedModelRole ?? null,
    actualModelId: record.actualModelId ?? null,
    providerRoute: record.providerRoute ?? null,
    fallbackCount: record.fallbackCount ?? 0,
    retrievalCounts: record.retrievalCounts ?? null,
    webProvider: record.webProvider ?? null,
    latencyMs: record.latencyMs ?? null,
    tokenUsage: record.tokenUsage ?? null,
    estimatedCostUsd: record.estimatedCostUsd ?? null,
    success: record.success,
    evaluationTags: record.evaluationTags ?? [],
    confidentialityLevel: record.confidentialityLevel,
    payloadPolicy: metadataOnly ? "metadata_only" : "redacted",
  }) as Record<string, unknown>;

  if (metadataOnly) {
    return { metadata, metadataOnly: true };
  }

  return {
    metadata,
    metadataOnly: false,
    input: scrubSecrets(record.input),
    output: scrubSecrets(record.output),
  };
}

export function langfuseConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    env.LANGFUSE_PUBLIC_KEY?.trim() &&
      env.LANGFUSE_SECRET_KEY?.trim() &&
      env.LANGFUSE_BASE_URL?.trim(),
  );
}
