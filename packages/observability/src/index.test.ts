import { describe, expect, it } from "vitest";
import { buildSafeTracePayload } from "./tracing.js";
import { runEvaluationHarness, EVAL_FIXTURES } from "./evaluation.js";
import { scrubSecrets } from "./secrets.js";

describe("buildSafeTracePayload", () => {
  it("sends metadata only for people/executive", () => {
    const safe = buildSafeTracePayload({
      name: "answer",
      confidentialityLevel: "people",
      success: true,
      input: { prompt: "給与情報" },
      output: { text: "秘密" },
      actualModelId: "openai/gpt-4.1-mini",
    });
    expect(safe.metadataOnly).toBe(true);
    expect(safe.input).toBeUndefined();
    expect(safe.output).toBeUndefined();
    expect(safe.metadata.actualModelId).toBe("openai/gpt-4.1-mini");
  });

  it("redacts secrets in L1 traces", () => {
    const scrubbed = scrubSecrets({ apiKey: "secret-value", ok: true });
    expect(scrubbed).toEqual({ apiKey: "[REDACTED]", ok: true });
  });
});

describe("evaluation harness", () => {
  it("scores synthetic fixtures without calling providers", () => {
    const outputs = EVAL_FIXTURES.map((f) => ({
      fixtureId: f.id,
      output: {
        text: `${f.expectedMustInclude[0] ?? "結果"}。社内資料に基づきます。`,
        citations:
          f.expectedSourceTypes[0] === "web"
            ? [{ sourceType: "web", uri: "https://example.com" }]
            : f.expectedSourceTypes[0] === "knowledge"
              ? [{ sourceType: "knowledge", uri: null }]
              : [],
        latencyMs: 100,
        estimatedCostUsd: 0,
        usedWeb: f.expectedSourceTypes.includes("web"),
        usedInternalKnowledge: f.expectedSourceTypes.includes("knowledge"),
        leakedSecret: false,
      },
    }));
    const report = runEvaluationHarness(outputs);
    expect(report.results).toHaveLength(EVAL_FIXTURES.length);
    expect(report.average.security_compliance).toBe(1);
  });
});
