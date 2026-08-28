import { describe, expect, it } from "vitest";
import { classifyDirtyState, parsePorcelain } from "./dirty-state.js";

describe("git dirty state", () => {
  it("keeps pre-existing dirty files distinct from agent edits", () => {
    const before = parsePorcelain(" M src/user.ts\n");
    const after = parsePorcelain(" M src/user.ts\n M src/agent.ts\n");
    const classified = classifyDirtyState({
      beforePaths: before,
      afterPaths: after,
      agentTouched: ["src/agent.ts"],
    });
    expect(classified.preExisting).toContain("src/user.ts");
    expect(classified.agentTouched).toContain("src/agent.ts");
    expect(classified.overlap).not.toContain("src/agent.ts");
  });
});
