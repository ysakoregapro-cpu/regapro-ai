import { describe, expect, it } from "vitest";
import { classifyCommandRisk } from "./risk.js";
import { MemoryWorkspaceFs } from "../adapters/memory-workspace.js";
import { InProcessToolExecutor } from "../tools/executor.js";

describe("dangerous tools", () => {
  it("marks reset --hard and force push as auto-forbidden", () => {
    expect(classifyCommandRisk("git reset --hard").autoForbidden).toBe(true);
    expect(classifyCommandRisk("git push --force origin main").reason).toBe("force_push");
    expect(classifyCommandRisk("git status").risk).toBe("read");
  });

  it("does not auto-run dangerous commands", async () => {
    const fs = new MemoryWorkspaceFs("C:\\ws", "write", { "package.json": "{}" });
    const exec = new InProcessToolExecutor({
      fs,
      commands: {
        async run() {
          throw new Error("should not run");
        },
      },
      git: null,
    });
    const result = await exec.execute({
      call: {
        id: "1",
        name: "run_command",
        arguments: { command: "git reset --hard" },
      },
      workspace: {
        id: "w",
        deviceId: null,
        label: "ws",
        rootPath: "C:\\ws",
        permission: "write",
      },
      pasted: [],
      permission: "write",
      approved: false,
    });
    expect(result.ok).toBe(false);
    expect(result.metadata.approvalRequired).toBe(true);
    expect(result.metadata.blockedReason).toBe("git_reset_hard");
  });

  it("rejects path traversal through read_file", async () => {
    const fs = new MemoryWorkspaceFs("C:\\ws", "read", { "src/a.ts": "ok" });
    const exec = new InProcessToolExecutor({ fs, commands: null, git: null });
    const result = await exec.execute({
      call: {
        id: "1",
        name: "read_file",
        arguments: { path: "..\\..\\Windows\\win.ini" },
      },
      workspace: {
        id: "w",
        deviceId: null,
        label: "ws",
        rootPath: "C:\\ws",
        permission: "read",
      },
      pasted: [],
      permission: "read",
      approved: false,
    });
    expect(result.ok).toBe(false);
    expect(result.metadata.blockedReason).toBe("PATH_OUTSIDE_WORKSPACE");
  });

  it("blocks writes on READ workspaces", async () => {
    const fs = new MemoryWorkspaceFs("C:\\ws", "read", { "a.ts": "1" });
    const exec = new InProcessToolExecutor({ fs, commands: null, git: null });
    const result = await exec.execute({
      call: {
        id: "1",
        name: "write_file",
        arguments: { path: "a.ts", content: "2" },
      },
      workspace: {
        id: "w",
        deviceId: null,
        label: "ws",
        rootPath: "C:\\ws",
        permission: "read",
      },
      pasted: [],
      permission: "read",
      approved: false,
    });
    expect(result.metadata.blockedReason).toBe("WRITE_NOT_PERMITTED");
  });
});
