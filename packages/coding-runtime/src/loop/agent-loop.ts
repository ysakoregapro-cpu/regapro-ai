import { planCodingSession, roleForIteration } from "../planner/coding-planner.js";
import { toolsForMode } from "../tools/catalog.js";
import { classifyCodingIntent } from "../intent/coding-intent.js";
import { parsePorcelain, classifyDirtyState, formatGitSnapshotNotice } from "../git/dirty-state.js";
import { detectQualityGates } from "../verification/detect-gates.js";
import { CodingBudgetGuard } from "./budget.js";
import { FailureGuard, observationForModel } from "./observation.js";
import type { CodingChatMessage } from "../loop-messages.js";
import type {
  ApprovalPort,
  CodingModelPort,
  CodingRuntimeInput,
  GitPort,
  ToolExecutorPort,
  WorkspaceFsPort,
} from "../ports.js";
import type {
  ApprovalRequest,
  CodingRunResult,
  CodingStep,
  FileChange,
  ToolCall,
  ToolName,
} from "../types.js";

const FINISH_HINT = `You are the RegaloProfessional Coding Agent.
Use tools. Prefer apply_patch over rewriting entire files.
Do not dump the whole repository into the answer.
Do not send secrets. Do not run git reset --hard, git clean, force push, or production DB mutations.
When done, respond with JSON: {"type":"finish","text":"..."}.
When calling tools, respond with JSON: {"type":"tool_calls","calls":[{"id":"1","name":"tool_name","arguments":{}}]}.
For pasted GAS/JS/TS without a workspace, inspect_pasted is enough — missing local files is not an error.`;

function parseModelPayload(text: string | null, toolCalls: ToolCall[]): {
  finishText: string | null;
  calls: ToolCall[];
} {
  if (toolCalls.length) return { finishText: null, calls: toolCalls };
  if (!text) return { finishText: null, calls: [] };
  const trimmed = text.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { finishText: trimmed, calls: [] };
  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      type?: string;
      text?: string;
      calls?: Array<{ id?: string; name?: string; arguments?: Record<string, unknown> }>;
      tool?: string;
      arguments?: Record<string, unknown>;
    };
    if (parsed.type === "finish" || typeof parsed.text === "string" && !parsed.calls && parsed.type !== "tool_calls") {
      if (parsed.type === "finish" || (!parsed.calls && parsed.text && !parsed.tool)) {
        return { finishText: parsed.text ?? trimmed, calls: [] };
      }
    }
    if (parsed.type === "tool_calls" && Array.isArray(parsed.calls)) {
      return {
        finishText: null,
        calls: parsed.calls.map((c, i) => ({
          id: c.id ?? `call_${i + 1}`,
          name: c.name as ToolName,
          arguments: c.arguments ?? {},
        })),
      };
    }
    if (parsed.tool) {
      return {
        finishText: null,
        calls: [
          {
            id: "call_1",
            name: parsed.tool as ToolName,
            arguments: parsed.arguments ?? {},
          },
        ],
      };
    }
  } catch {
    return { finishText: trimmed, calls: [] };
  }
  return { finishText: trimmed, calls: [] };
}

export async function runCodingAgentLoop(input: {
  runtime: CodingRuntimeInput;
  model: CodingModelPort;
  executor: ToolExecutorPort;
  fs: WorkspaceFsPort | null;
  git: GitPort | null;
  approval?: ApprovalPort | null;
}): Promise<CodingRunResult> {
  const started = Date.now();
  const intent = classifyCodingIntent(input.runtime.userText);
  const pasted = input.runtime.pasted?.length ? input.runtime.pasted : intent.pastedBlocks;
  const mode = input.runtime.mode ?? intent.mode ?? "pasted";
  const plan = planCodingSession({
    userText: input.runtime.userText,
    intent: { ...intent, mode },
    hasWorkspace: Boolean(input.runtime.workspace && input.fs),
    hasInternalKnowledge: Boolean(input.runtime.knowledge?.length),
  });
  const budget = new CodingBudgetGuard(input.runtime.budget);
  const fail = new FailureGuard();
  const steps: CodingStep[] = [
    { iteration: 0, kind: "plan", summary: plan.steps.join(" → "), status: "ok" },
  ];
  const changed: FileChange[] = [];
  const pendingApprovals: ApprovalRequest[] = [];
  const toolNames: ToolName[] = [];
  let lastFailedVerification = false;
  let modelId = "unknown";
  let finishText = "";
  let status: CodingRunResult["status"] = "running";
  let gitBefore: string[] = [];

  if (input.git) {
    const snap = await input.git.status();
    gitBefore = parsePorcelain(snap.porcelain);
    steps.push({
      iteration: 0,
      kind: "tool",
      summary: "git status (start)",
      toolName: "git_status",
      status: "ok",
    });
  }

  const knowledgeBlock =
    input.runtime.knowledge
      ?.slice(0, 6)
      .map((k) => `- ${k.title}: ${k.excerpt.slice(0, 280)}`)
      .join("\n") ?? "なし";

  const messages: CodingChatMessage[] = [
    { role: "system", content: FINISH_HINT },
    {
      role: "user",
      content: [
        `Goal:\n${input.runtime.userText}`,
        `Mode: ${mode}`,
        `Plan:\n${plan.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
        `Company knowledge:\n${knowledgeBlock}`,
        pasted.length
          ? `Pasted files:\n${pasted.map((p) => `${p.filenameHint} (${p.language})`).join(", ")}`
          : "",
        input.runtime.workspace
          ? `Workspace: ${input.runtime.workspace.rootPath} permission=${input.runtime.workspace.permission}`
          : "Workspace: none (pasted-only is valid)",
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];

  const tools = toolsForMode(mode);
  let iterations = 0;

  while (budget.takeIteration()) {
    if (input.runtime.abortSignal?.aborted) {
      status = "stopped";
      finishText = "実行を停止しました。";
      break;
    }
    iterations = budget.iterations;
    const role = roleForIteration({ plan, iteration: iterations - 1, lastFailedVerification });
    const turn = await input.model.complete({
      messages,
      tools,
      role,
      abortSignal: input.runtime.abortSignal,
    });
    modelId = turn.modelId;
    budget.addCost(turn.estimatedCostUsd ?? null);

    const parsed = parseModelPayload(turn.text, turn.toolCalls);
    if (parsed.calls.length === 0) {
      finishText = parsed.finishText ?? turn.text ?? "作業を完了しました。";
      status = "completed";
      steps.push({
        iteration: iterations,
        kind: "finish",
        summary: "model finished",
        status: "ok",
      });
      break;
    }

    messages.push({
      role: "assistant",
      content: turn.text ?? "",
      toolCalls: parsed.calls,
    });

    let stopForApproval = false;
    for (const call of parsed.calls) {
      if (!budget.takeToolCall()) {
        status = "failed";
        finishText = "ツール呼び出し上限に達したため停止しました。";
        break;
      }
      const fingerprint = `${call.name}:${JSON.stringify(call.arguments).slice(0, 200)}`;
      const preApproved = input.approval
        ? await input.approval.isApproved({
            runId: input.runtime.runId,
            toolName: call.name,
            fingerprint,
          })
        : false;
      const observation = await input.executor.execute({
        call,
        workspace: input.runtime.workspace,
        pasted,
        permission: input.runtime.workspace?.permission ?? (mode === "pasted" ? "write" : "read"),
        approved: preApproved,
      });
      toolNames.push(call.name);
      const repeat = fail.note(observation);
      if (observation.metadata.changed && observation.metadata.path) {
        changed.push({
          path: observation.metadata.path,
          action: call.name === "create_file" ? "create" : "update",
          beforeHash: null,
          afterHash: null,
        });
      }
      if (observation.metadata.approvalRequired) {
        const req: ApprovalRequest = {
          id: `${input.runtime.runId}:${call.id}`,
          toolName: call.name,
          riskLevel: observation.riskLevel,
          summary: `${call.name} は明示承認が必要です`,
          argumentsPreview: JSON.stringify(call.arguments).slice(0, 240),
        };
        pendingApprovals.push(req);
        await input.approval?.request({
          ...req,
          runId: input.runtime.runId,
          fingerprint,
        });
        stopForApproval = true;
      }
      steps.push({
        iteration: iterations,
        kind: observation.metadata.approvalRequired ? "approval" : "tool",
        summary: observation.ok ? call.name : `${call.name} failed`,
        toolName: call.name,
        status: observation.ok ? "ok" : observation.metadata.approvalRequired ? "blocked" : "error",
      });
      const body = observationForModel(
        observation,
        budget.limits.maxObservationChars,
      );
      messages.push({
        role: "tool",
        toolCallId: call.id,
        name: call.name,
        content: repeat.repeat ? `${body}\n${fail.hint(repeat.signature)}` : body,
      });
      if (repeat.repeat && !observation.ok) {
        lastFailedVerification = true;
      }
    }
    if (stopForApproval) {
      status = "awaiting_approval";
      finishText = "危険操作の承認待ちです。承認後に再開できます。";
      break;
    }
    if (status === "failed") break;
  }

  if (status === "running") {
    status = "failed";
    finishText = `停止理由: ${budget.exhaustedReason() ?? "unknown"}`;
  }

  let verification: CodingRunResult["verification"] = null;
  if (input.fs && mode !== "pasted") {
    let pkg: string | null = null;
    if (await input.fs.exists("package.json")) {
      pkg = (await input.fs.read("package.json")).content;
    }
    const detected = detectQualityGates(pkg);
    verification = {
      detected,
      ran: [],
      passed: true,
      summary: detected.length
        ? `検出: ${detected.join(", ")}`
        : "package.json に検証スクリプトはありません（追加しませんでした）。",
    };
  }

  let gitSnap: CodingRunResult["git"] = null;
  if (input.git) {
    const after = await input.git.status();
    const diff = await input.git.diff();
    const classified = classifyDirtyState({
      beforePaths: gitBefore,
      afterPaths: parsePorcelain(after.porcelain),
      agentTouched: changed.map((c) => c.path),
    });
    gitSnap = {
      isRepo: after.isRepo,
      branch: after.branch,
      porcelain: after.porcelain,
      preExistingDirty: classified.preExisting,
      agentTouched: classified.agentTouched,
      diffStat: diff.slice(0, 4000),
    };
    const notice = formatGitSnapshotNotice(classified);
    if (notice) finishText = `${finishText}\n\n${notice}`;
  }

  const limitations: string[] = [];
  if (mode !== "pasted" && !input.runtime.workspace) {
    limitations.push("Local Agent / Workspace 未接続のため、貼り付けコード経路で処理しました。");
  }
  if (pendingApprovals.length) {
    limitations.push("危険操作は自動実行していません。");
  }

  return {
    runId: input.runtime.runId,
    status,
    mode,
    plan,
    text: finishText.trim(),
    steps,
    changedFiles: changed,
    verification,
    git: gitSnap,
    limitations,
    modelRole: plan.primaryRole,
    modelId,
    iterations: budget.iterations,
    toolCalls: budget.toolCalls,
    latencyMs: Date.now() - started,
    estimatedCostUsd: budget.estimatedCostUsd || null,
    pendingApprovals,
  };
}
