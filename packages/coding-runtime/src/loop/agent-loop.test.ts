import { describe, expect, it } from "vitest";
import { buildAccessContext } from "@regapro/security";
import { CodingRuntime } from "../runtime.js";
import { ScriptedCodingModel } from "../adapters/scripted-model.js";
import { MemoryWorkspaceFs } from "../adapters/memory-workspace.js";
import { InProcessToolExecutor } from "../tools/executor.js";
import { CodingBudgetGuard } from "./budget.js";

function access() {
  return buildAccessContext({
    userId: "user-1",
    organizationId: "org-1",
    membershipId: "mem-1",
    departmentId: "dept-1",
    departmentKey: "engineering",
    roles: ["editor"],
    threadConfidentialityLevel: "company",
    threadVisibility: "organization",
  });
}

describe("agent loop", () => {
  it("stops at the iteration budget instead of looping forever", async () => {
    const model = new ScriptedCodingModel(
      Array.from({ length: 30 }, () => ({
        toolCalls: [{ name: "inspect_pasted" as const, arguments: {} }],
      })),
    );
    const runtime = new CodingRuntime({ model });
    const result = await runtime.run({
      access: access(),
      runId: "11111111-1111-4111-8111-111111111111",
      threadId: null,
      userText: "このコードを直して\n```js\nfunction add(a,b){return a-b}\n```",
      mode: "pasted",
      workspace: null,
      device: null,
      budget: { maxIterations: 3, maxToolCalls: 3, maxMillis: 10_000 },
    });
    expect(result.iterations).toBeLessThanOrEqual(3);
    expect(result.status === "failed" || result.status === "completed").toBe(true);
  });

  it("runs pasted GAS without a local workspace", async () => {
    const model = new ScriptedCodingModel([
      { toolCalls: [{ name: "inspect_pasted" }] },
      {
        text: JSON.stringify({
          type: "finish",
          text: "onOpen のメニュー登録は問題ありません。エラー処理を SpreadsheetApp.getUi() の前に入れる改訂例です。",
        }),
      },
    ]);
    const runtime = new CodingRuntime({ model });
    const result = await runtime.run({
      access: access(),
      runId: "22222222-2222-4222-8222-222222222222",
      threadId: null,
      userText: `このGAS直して\n\`\`\`js\nfunction onOpen(){ SpreadsheetApp.getUi().createMenu("X").addToUi(); }\n\`\`\``,
      workspace: null,
      device: null,
    });
    expect(result.mode).toBe("pasted");
    expect(result.status).toBe("completed");
    expect(result.text).toMatch(/SpreadsheetApp|onOpen|メニュー/);
    expect(result.limitations.join(" ")).not.toMatch(/FILE_NOT_FOUND/);
  });

  it("enforces READ workspaces and records approval for dangerous tools", async () => {
    const fs = new MemoryWorkspaceFs("C:\\ws", "read", { "src/a.ts": "export const n = 1;\n" });
    const exec = new InProcessToolExecutor({ fs, commands: null, git: null });
    const model = new ScriptedCodingModel([
      {
        toolCalls: [{ name: "write_file", arguments: { path: "src/a.ts", content: "x" } }],
      },
      { text: JSON.stringify({ type: "finish", text: "READのため書き込みしませんでした。" }) },
    ]);
    const runtime = new CodingRuntime({
      model,
      executor: exec,
      fs,
    });
    const result = await runtime.run({
      access: access(),
      runId: "33333333-3333-4333-8333-333333333333",
      threadId: null,
      userText: "src を直して",
      mode: "workspace",
      workspace: {
        id: "w",
        deviceId: "d",
        label: "ws",
        rootPath: "C:\\ws",
        permission: "read",
      },
      device: { id: "d", label: "NOTEBOOK", os: "windows", status: "paired" },
    });
    expect(result.changedFiles).toHaveLength(0);
    expect(result.steps.some((s) => s.status === "error" || s.status === "blocked")).toBe(true);
  });
});

describe("CodingBudgetGuard", () => {
  it("exhausts after max iterations", () => {
    const g = new CodingBudgetGuard({ maxIterations: 2, maxToolCalls: 10, maxMillis: 60_000 });
    expect(g.takeIteration()).toBe(true);
    expect(g.takeIteration()).toBe(true);
    expect(g.takeIteration()).toBe(false);
    expect(g.exhaustedReason()).toBe("max_iterations");
  });
});
