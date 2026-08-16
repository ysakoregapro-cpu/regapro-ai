import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@regapro/shared",
    "@regapro/security",
    "@regapro/database",
    "@regapro/tasks",
    "@regapro/knowledge",
    "@regapro/research",
    "@regapro/notifications",
    "@regapro/local-ai",
    "@regapro/ai-runtime",
    "@regapro/web-intelligence",
    "@regapro/prompting",
    "@regapro/artifacts",
    "@regapro/observability",
    "@regapro/ui",
  ],
};

export default nextConfig;
