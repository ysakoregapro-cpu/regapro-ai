/**
 * Node-only OpenTelemetry processor for Langfuse Cloud.
 * Import from Next.js instrumentation (nodejs runtime) only — never Edge.
 */
export function startLangfuseOtel(env: NodeJS.ProcessEnv = process.env): boolean {
  const publicKey = env.LANGFUSE_PUBLIC_KEY?.trim();
  const secretKey = env.LANGFUSE_SECRET_KEY?.trim();
  const baseUrl = env.LANGFUSE_BASE_URL?.trim();
  if (!publicKey || !secretKey || !baseUrl) return false;

  void import("@opentelemetry/sdk-node")
    .then(async ({ NodeSDK }) => {
      const { LangfuseSpanProcessor } = await import("@langfuse/otel");
      const sdk = new NodeSDK({
        spanProcessors: [
          new LangfuseSpanProcessor({
            publicKey,
            secretKey,
            baseUrl,
          }),
        ],
      });
      sdk.start();
    })
    .catch(() => {
      // Missing optional SDK must not crash the app.
    });
  return true;
}
