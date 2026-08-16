export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startLangfuseOtel } = await import("@regapro/observability/langfuse-node");
  startLangfuseOtel();
}
