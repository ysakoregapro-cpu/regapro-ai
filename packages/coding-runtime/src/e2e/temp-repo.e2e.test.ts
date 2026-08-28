import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildAccessContext } from "@regapro/security";
import { CodingRuntime } from "../runtime.js";
import { ScriptedCodingModel } from "../adapters/scripted-model.js";
import { NodeCommandExecutor, NodeGit, NodeWorkspaceFs, runProcess } from "../adapters/node-workspace.js";
import { InProcessToolExecutor } from "../tools/executor.js";

async function git(cwd: string, args: string[]) {
  const r = await runProcess({ argv: ["git", ...args], cwd, timeoutMs: 20_000 });
  if (!r.ok) throw new Error(r.stderr || r.stdout || args.join(" "));
  return r;
}

describe("temporary repository e2e", () => {
  it("fixes a function via read → patch → test without touching user repos", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "regapro-coding-e2e-"));
    try {
      await git(root, ["init"]);
      await git(root, ["config", "user.email", "coding-e2e@regapro.local"]);
      await git(root, ["config", "user.name", "Coding E2E"]);
      await git(root, ["config", "core.autocrlf", "false"]);
      await mkdir(path.join(root, "src"), { recursive: true });
      const buggy = "export function add(a, b) {\n  return a - b;\n}\n";
      await writeFile(path.join(root, "src/add.js"), buggy, "utf8");
      await writeFile(
        path.join(root, "src/add.test.js"),
        `import { describe, it } from "node:test";\nimport assert from "node:assert/strict";\nimport { add } from "./add.js";\ndescribe("add", () => {\n  it("adds", () => assert.equal(add(1, 2), 3));\n});\n`,
        "utf8",
      );
      await writeFile(
        path.join(root, "package.json"),
        JSON.stringify({ name: "fixture", type: "module", scripts: { test: "node --test src/add.test.js" } }, null, 2),
        "utf8",
      );
      await git(root, ["add", "."]);
      await git(root, ["commit", "-m", "init buggy add"]);

      const fs = new NodeWorkspaceFs(root, "write");
      const gitPort = new NodeGit(root);
      const commands = new NodeCommandExecutor(root);
      const exec = new InProcessToolExecutor({ fs, commands, git: gitPort });
      const current = await fs.read("src/add.js", undefined, { mask: false });
      const model = new ScriptedCodingModel([
        { toolCalls: [{ name: "git_status" }] },
        { toolCalls: [{ name: "read_file", arguments: { path: "src/add.js" } }] },
        {
          toolCalls: [
            {
              name: "apply_patch",
              arguments: {
                path: "src/add.js",
                expectedHash: current.hash,
                patch: `<<<<
  return a - b;
====
  return a + b;
>>>>`,
              },
            },
          ],
        },
        {
          toolCalls: [
            {
              name: "run_command",
              arguments: { command: "node --test src/add.test.js" },
            },
          ],
        },
        { toolCalls: [{ name: "git_diff" }] },
        { text: JSON.stringify({ type: "finish", text: "add の符号を修正し、テストは通過しました。" }) },
      ]);

      const runtime = new CodingRuntime({ model, executor: exec, fs, git: gitPort });
      const result = await runtime.run({
        access: buildAccessContext({
          userId: "user-1",
          organizationId: "org-1",
          membershipId: "mem-1",
          departmentId: "dept-1",
          departmentKey: "engineering",
          roles: ["editor"],
          threadConfidentialityLevel: "company",
          threadVisibility: "organization",
        }),
        runId: "44444444-4444-4444-8444-444444444444",
        threadId: null,
        userText: "add 関数のバグを修正してテストまで通して",
        mode: "vibe",
        workspace: {
          id: "tmp",
          deviceId: "local",
          label: "fixture",
          rootPath: root,
          permission: "write",
        },
        device: { id: "local", label: "NOTEBOOK", os: "windows", status: "paired" },
      });

      expect(result.status).toBe("completed");
      expect(result.changedFiles.some((f) => f.path.replace(/\\/g, "/").includes("src/add.js"))).toBe(
        true,
      );
      expect(result.git?.diffStat ?? "").toMatch(/\+/);
      const testObs = result.steps.filter((s) => s.toolName === "run_command" || s.toolName === "run_test");
      expect(testObs.some((s) => s.status === "ok")).toBe(true);
      expect(root.includes("regapro-ai") && !root.includes("regapro-coding-e2e")).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
