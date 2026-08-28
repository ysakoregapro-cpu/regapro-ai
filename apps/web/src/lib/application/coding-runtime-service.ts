import type { AccessContext } from "@regapro/security";
import type { CodingRuntimePort, CodingRuntimeResult } from "@regapro/ai-runtime";
import type { ModelProvider } from "@regapro/ai-runtime";
import {
  CodingRuntime,
  type CodingRunResult,
} from "@regapro/coding-runtime";
import { emitRuntimeTrace } from "@regapro/observability";
import { ModelProviderCodingAdapter } from "@/lib/application/coding-model-adapter";

function toView(result: CodingRunResult): NonNullable<CodingRuntimeResult["coding"]> {
  return {
    runId: result.runId,
    mode: result.mode,
    status: result.status,
    deviceLabel: null,
    workspaceLabel: result.plan.needWorkspace ? "local" : "pasted",
    currentStep: result.steps.at(-1)?.summary ?? result.status,
    toolNames: result.steps.map((s) => s.toolName).filter((n): n is NonNullable<typeof n> => Boolean(n)),
    changedFiles: result.changedFiles.map((f) => f.path),
    diffPreview: result.git?.diffStat?.slice(0, 2000) ?? null,
    pendingApproval: result.pendingApprovals.length > 0,
    verificationSummary: result.verification?.summary ?? null,
  };
}

export function createCodingRuntimePort(input: {
  access: AccessContext;
  model: ModelProvider;
}): CodingRuntimePort {
  const adapter = new ModelProviderCodingAdapter(input.model, input.access);
  const runtime = new CodingRuntime({ model: adapter });
  return {
    async run(req) {
      const started = Date.now();
      const result = await runtime.run({
        access: req.access,
        runId: globalThis.crypto.randomUUID(),
        threadId: req.threadId,
        userText: req.userText,
        workspace: null,
        device: null,
        knowledge: req.knowledge,
      });
      void emitRuntimeTrace({
        name: "regapro.coding",
        requestId: req.threadId ?? result.runId,
        intent: "code",
        workflow: result.mode,
        selectedModelRole: result.modelRole,
        actualModelId: result.modelId,
        providerRoute: input.model.id,
        latencyMs: Date.now() - started,
        success: result.status === "completed",
        confidentialityLevel: req.access.threadConfidentialityLevel,
        evaluationTags: ["coding", result.mode, ...result.steps.map((s) => s.toolName ?? s.kind)],
      });
      const view = toView(result);
      return {
        text: [result.text, formatCodingFooter(result)].filter(Boolean).join("\n\n"),
        modelId: result.modelId,
        role: result.modelRole,
        usage: null,
        estimatedCostUsd: result.estimatedCostUsd,
        limitations: result.limitations,
        coding: view,
      };
    },
  };
}

function formatCodingFooter(result: CodingRunResult): string {
  const mode =
    result.mode === "pasted" ? "貼り付けコード" : result.mode === "vibe" ? "リポジトリ作業" : "Workspace";
  const statusJa =
    result.status === "completed"
      ? "完了"
      : result.status === "awaiting_approval"
        ? "承認待ち"
        : result.status === "needs_device"
          ? "端末未接続"
          : result.status === "stopped"
            ? "停止"
            : "未完了";
  const files = result.changedFiles.length
    ? `変更: ${result.changedFiles.map((f) => f.path).join(", ")}`
    : "ファイル変更なし";
  const approval = result.pendingApprovals.length ? "危険操作は承認待ちです。" : "";
  return [`—`, `${mode} · ${statusJa}`, files, approval].filter(Boolean).join("\n");
}
