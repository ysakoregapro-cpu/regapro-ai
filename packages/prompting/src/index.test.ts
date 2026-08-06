import { describe, expect, it } from "vitest";
import { generateCursorPrompt, getCursorPromptSections } from "./index.js";

describe("cursor prompt sections", () => {
  it("includes all required sections", () => {
    const sections = getCursorPromptSections();
    expect(sections).toContain("code audit");
    expect(sections).toContain("typecheck");
    expect(sections).toContain("build");
  });

  it("generates prompt with verification commands", () => {
    const prompt = generateCursorPrompt({
      title: "Add feature",
      objective: "Implement X",
      scope: ["packages/shared"],
      impact: ["API surface"],
      requirements: ["Use Zod"],
      prohibitions: ["No secrets in logs"],
      verificationCommands: ["npm run test"],
      completionCriteria: ["Tests pass"],
      changedFilesReport: true,
    });
    expect(prompt.content).toContain("## Code audit");
    expect(prompt.content).toContain("npm run typecheck");
    expect(prompt.content).toContain("Changed files report");
  });
});
