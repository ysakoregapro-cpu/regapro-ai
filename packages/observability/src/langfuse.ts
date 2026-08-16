import { buildSafeTracePayload, langfuseConfigured, type RuntimeTraceRecord } from "./tracing.js";

type ObservationLike = {
  update: (input: Record<string, unknown>) => void;
};

/**
 * Official Langfuse JS SDK (@langfuse/tracing) — OpenTelemetry context.
 * Never records API keys. L2/L3 traces are metadata-only.
 */
export async function emitRuntimeTrace(record: RuntimeTraceRecord): Promise<void> {
  if (!langfuseConfigured()) return;
  const safe = buildSafeTracePayload(record);
  try {
    const { startActiveObservation } = await import("@langfuse/tracing");
    await startActiveObservation(record.name, async (span: ObservationLike) => {
      span.update({
        metadata: safe.metadata,
        ...(safe.metadataOnly ? {} : { input: safe.input, output: safe.output }),
      });
    });
  } catch {
    // Observability must never break the product path.
  }
}

export async function flushLangfuse(): Promise<void> {
  try {
    const mod = await import("@langfuse/tracing");
    const flush = (mod as { flush?: () => Promise<void> }).flush;
    if (typeof flush === "function") await flush();
  } catch {
    // ignore
  }
}
