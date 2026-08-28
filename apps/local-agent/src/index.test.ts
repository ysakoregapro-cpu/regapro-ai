import path from "node:path";
import { describe, expect, it } from "vitest";
import { addWorkspace, defaultConfig } from "./config.js";
import { executeCloudCommand } from "./outbound.js";

describe("local agent workspace allowlist", () => {
  it("refuses C:\\ and paths that were not allowed", async () => {
    const cfg = defaultConfig();
    expect(() => addWorkspace(cfg, "C:\\")).toThrow(/WORKSPACE_TOO_BROAD/);
    const allowed = addWorkspace(cfg, path.resolve("C:\\Users\\natan\\source\\regapro-expense"));
    await expect(
      executeCloudCommand(allowed, {
        id: "1",
        runId: "r",
        workspaceRoot: "C:\\Windows",
        permission: "read",
        approved: false,
        call: { id: "c", name: "list_directory", arguments: { path: "." } },
      }),
    ).rejects.toThrow(/WORKSPACE_NOT_ALLOWED/);
  });
});
