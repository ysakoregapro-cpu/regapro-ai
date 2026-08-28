import { describe, expect, it } from "vitest";
import { applyPatchToContent, sha256 } from "./apply-patch.js";
import { MemoryWorkspaceFs } from "../adapters/memory-workspace.js";
import { InProcessToolExecutor } from "../tools/executor.js";

describe("apply_patch", () => {
  it("applies search/replace hunks", () => {
    const original = "function add(a, b) {\n  return a - b;\n}\n";
    const patch = `<<<<
  return a - b;
====
  return a + b;
>>>>`;
    const result = applyPatchToContent(original, patch);
    expect(result.ok).toBe(true);
    expect(result.next).toContain("return a + b");
  });

  it("rejects stale hashes", async () => {
    const fs = new MemoryWorkspaceFs("C:\\ws", "write", {
      "src/a.js": "v1",
    });
    const exec = new InProcessToolExecutor({ fs, commands: null, git: null });
    const stale = await exec.execute({
      call: {
        id: "1",
        name: "apply_patch",
        arguments: {
          path: "src/a.js",
          expectedHash: sha256("old"),
          patch: `<<<<
v1
====
v2
>>>>`,
        },
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
    expect(stale.ok).toBe(false);
    expect(stale.metadata.blockedReason).toBe("STALE_FILE");
  });
});
