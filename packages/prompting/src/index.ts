import { z } from "zod";

export const PromptTargetSchema = z.enum([
  "cursor",
  "chatgpt",
  "claude",
  "gemini",
  "perplexity",
  "manus",
  "generic",
]);

export type PromptTarget = z.infer<typeof PromptTargetSchema>;

export interface PromptGenerationInput {
  title: string;
  objective: string;
  scope: string[];
  impact: string[];
  requirements: string[];
  prohibitions: string[];
  verificationCommands: string[];
  completionCriteria: string[];
  changedFilesReport: boolean;
}

export interface GeneratedPrompt {
  target: PromptTarget;
  content: string;
}

const CURSOR_SECTIONS = [
  "code audit",
  "scope",
  "impact",
  "requirements",
  "prohibitions",
  "verification commands",
  "completion criteria",
  "changed files report",
  "typecheck",
  "lint",
  "test",
  "build",
] as const;

export function generateCursorPrompt(
  input: PromptGenerationInput,
): GeneratedPrompt {
  const sections = [
    `# ${input.title}`,
    "",
    "## Code audit",
    "Review existing code related to the objective before making changes.",
    "",
    "## Scope",
    ...input.scope.map((s) => `- ${s}`),
    "",
    "## Impact",
    ...input.impact.map((s) => `- ${s}`),
    "",
    "## Requirements",
    ...input.requirements.map((s) => `- ${s}`),
    "",
    "## Prohibitions",
    ...input.prohibitions.map((s) => `- ${s}`),
    "",
    "## Verification commands",
    ...input.verificationCommands.map((s) => `- \`${s}\``),
    "",
    "## Completion criteria",
    ...input.completionCriteria.map((s) => `- ${s}`),
    "",
    "## Changed files report",
    input.changedFilesReport
      ? "- List all changed files in the final summary."
      : "- No changed files report required.",
    "",
    "## Typecheck",
    "- Run `npm run typecheck` and fix all errors.",
    "",
    "## Lint",
    "- Run `npm run lint` and fix all errors.",
    "",
    "## Test",
    "- Run `npm run test` and ensure all tests pass.",
    "",
    "## Build",
    "- Run `npm run build` and ensure the build succeeds.",
    "",
    "## Objective",
    input.objective,
  ];

  return { target: "cursor", content: sections.join("\n") };
}

export function generatePrompt(
  target: PromptTarget,
  input: PromptGenerationInput,
): GeneratedPrompt {
  if (target === "cursor") return generateCursorPrompt(input);

  const header = `# ${input.title}\n\nObjective: ${input.objective}\n\n`;
  const body = [
    "## Requirements",
    ...input.requirements.map((s) => `- ${s}`),
    "",
    "## Constraints",
    ...input.prohibitions.map((s) => `- ${s}`),
  ].join("\n");

  return { target, content: header + body };
}

export function getCursorPromptSections(): readonly string[] {
  return CURSOR_SECTIONS;
}
