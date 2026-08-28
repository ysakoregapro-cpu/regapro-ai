import { randomUUID } from "node:crypto";
import { classifyCodingIntent } from "./intent/coding-intent.js";
import { seedPastedWorkspace } from "./adapters/memory-workspace.js";
import { InProcessToolExecutor } from "./tools/executor.js";
import { runCodingAgentLoop } from "./loop/agent-loop.js";
import type {
  CodingModelPort,
  CodingRuntimeInput,
  CodingRuntimePort,
  GitPort,
  ToolExecutorPort,
  WorkspaceFsPort,
} from "./ports.js";
import type { CodingRunResult } from "./types.js";

export class CodingRuntime implements CodingRuntimePort {
  constructor(
    private readonly deps: {
      model: CodingModelPort;
      executor?: ToolExecutorPort;
      fs?: WorkspaceFsPort | null;
      git?: GitPort | null;
    },
  ) {}

  async run(input: CodingRuntimeInput): Promise<CodingRunResult> {
    const intent = classifyCodingIntent(input.userText);
    const pasted = input.pasted?.length ? input.pasted : intent.pastedBlocks;
    const mode = input.mode ?? intent.mode ?? "pasted";

    let fs = this.deps.fs ?? null;
    let executor = this.deps.executor;
    if (!fs && pasted.length > 0) {
      const files: Record<string, string> = {};
      pasted.forEach((b, i) => {
        files[b.filenameHint || `pasted-${i + 1}.txt`] = b.code;
      });
      fs = seedPastedWorkspace(files);
    }
    if (!executor) {
      executor = new InProcessToolExecutor({
        fs,
        commands: null,
        git: this.deps.git ?? null,
      });
    }

    if ((mode === "workspace" || mode === "vibe") && !input.workspace) {
      const pastedRun = await runCodingAgentLoop({
        runtime: { ...input, mode: pasted.length ? "pasted" : mode, runId: input.runId },
        model: this.deps.model,
        executor,
        fs,
        git: this.deps.git ?? null,
      });
      if (!pasted.length) {
        return {
          ...pastedRun,
          status: "needs_device",
          text:
            "この依頼はローカルWorkspaceが必要です。RegaloProfessional Local Agent を起動し、許可したフォルダを接続してください。貼り付けコードがあれば Workspace 無しでも進められます。",
          limitations: [
            ...pastedRun.limitations,
            "Local Agent 未接続",
          ],
        };
      }
      return {
        ...pastedRun,
        limitations: [
          ...pastedRun.limitations,
          "Workspace 未接続のため pasted code として処理しました。",
        ],
      };
    }

    return runCodingAgentLoop({
      runtime: { ...input, mode, pasted, runId: input.runId || randomUUID() },
      model: this.deps.model,
      executor,
      fs,
      git: this.deps.git ?? null,
    });
  }
}
