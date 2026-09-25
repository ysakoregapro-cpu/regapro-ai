import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@regapro/knowledge/approval-messages": path.resolve(
        __dirname,
        "../../packages/knowledge/src/approval-messages.ts",
      ),
      "@regapro/work": path.resolve(__dirname, "../../packages/work/src/index.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
