import type { ToolDefinition, ToolName } from "../types.js";

const stringParam = { type: "string" };
const numberParam = { type: "integer" };

export const TOOL_CATALOG: readonly ToolDefinition[] = [
  {
    name: "workspace_list",
    description: "List allowed workspaces on the paired device.",
    riskLevel: "read",
    requiresWorkspace: false,
    requiresExplicitApproval: false,
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "workspace_info",
    description: "Show current workspace root, permission, git branch, and package name.",
    riskLevel: "read",
    requiresWorkspace: true,
    requiresExplicitApproval: false,
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_directory",
    description: "List files in a relative directory. Skips node_modules/.git/dist by default.",
    riskLevel: "read",
    requiresWorkspace: true,
    requiresExplicitApproval: false,
    parameters: {
      type: "object",
      properties: { path: stringParam, maxEntries: numberParam },
      additionalProperties: false,
    },
  },
  {
    name: "read_file",
    description: "Read a text file. Secret files are masked. Returns content hash for stale-edit checks.",
    riskLevel: "read",
    requiresWorkspace: true,
    requiresExplicitApproval: false,
    parameters: {
      type: "object",
      properties: { path: stringParam },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "read_file_range",
    description: "Read inclusive 1-based line range of a text file.",
    riskLevel: "read",
    requiresWorkspace: true,
    requiresExplicitApproval: false,
    parameters: {
      type: "object",
      properties: { path: stringParam, startLine: numberParam, endLine: numberParam },
      required: ["path", "startLine", "endLine"],
      additionalProperties: false,
    },
  },
  {
    name: "search_files",
    description: "Find files by glob-like name query under the workspace.",
    riskLevel: "read",
    requiresWorkspace: true,
    requiresExplicitApproval: false,
    parameters: {
      type: "object",
      properties: { query: stringParam, glob: stringParam },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "find_text",
    description: "Search file contents for a literal or simple pattern. Skips vendor dirs.",
    riskLevel: "read",
    requiresWorkspace: true,
    requiresExplicitApproval: false,
    parameters: {
      type: "object",
      properties: { query: stringParam, glob: stringParam, maxResults: numberParam },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "git_status",
    description: "git status --porcelain=v1 and current branch. Distinguishes pre-existing dirty files.",
    riskLevel: "read",
    requiresWorkspace: true,
    requiresExplicitApproval: false,
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "git_diff",
    description: "Show git diff. Does not include secret files.",
    riskLevel: "read",
    requiresWorkspace: true,
    requiresExplicitApproval: false,
    parameters: {
      type: "object",
      properties: { path: stringParam, staged: { type: "boolean" } },
      additionalProperties: false,
    },
  },
  {
    name: "git_log",
    description: "Recent git log oneline.",
    riskLevel: "read",
    requiresWorkspace: true,
    requiresExplicitApproval: false,
    parameters: {
      type: "object",
      properties: { limit: numberParam },
      additionalProperties: false,
    },
  },
  {
    name: "git_branch",
    description: "List local branches.",
    riskLevel: "read",
    requiresWorkspace: true,
    requiresExplicitApproval: false,
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "git_checkout",
    description: "Checkout an existing branch. Force checkout is forbidden.",
    riskLevel: "write",
    requiresWorkspace: true,
    requiresExplicitApproval: false,
    parameters: {
      type: "object",
      properties: { branch: stringParam, create: { type: "boolean" } },
      required: ["branch"],
      additionalProperties: false,
    },
  },
  {
    name: "git_add",
    description: "Stage specific relative paths. Does not commit.",
    riskLevel: "write",
    requiresWorkspace: true,
    requiresExplicitApproval: false,
    parameters: {
      type: "object",
      properties: { paths: { type: "array", items: stringParam } },
      required: ["paths"],
      additionalProperties: false,
    },
  },
  {
    name: "write_file",
    description: "Overwrite a file. Prefer apply_patch. Pass expectedHash from read_file to avoid stale edits.",
    riskLevel: "write",
    requiresWorkspace: true,
    requiresExplicitApproval: false,
    parameters: {
      type: "object",
      properties: { path: stringParam, content: stringParam, expectedHash: stringParam },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "create_file",
    description: "Create a new file. Fails if it already exists.",
    riskLevel: "write",
    requiresWorkspace: true,
    requiresExplicitApproval: false,
    parameters: {
      type: "object",
      properties: { path: stringParam, content: stringParam },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "apply_patch",
    description: "Apply a focused patch (*** Begin Patch or unified diff). Preferred over rewriting whole files.",
    riskLevel: "write",
    requiresWorkspace: true,
    requiresExplicitApproval: false,
    parameters: {
      type: "object",
      properties: { path: stringParam, patch: stringParam, expectedHash: stringParam },
      required: ["patch"],
      additionalProperties: false,
    },
  },
  {
    name: "rename_file",
    description: "Rename a file inside the workspace.",
    riskLevel: "write",
    requiresWorkspace: true,
    requiresExplicitApproval: false,
    parameters: {
      type: "object",
      properties: { from: stringParam, to: stringParam },
      required: ["from", "to"],
      additionalProperties: false,
    },
  },
  {
    name: "run_command",
    description: "Run a non-interactive command in the workspace. Destructive git/DB/secret commands are blocked.",
    riskLevel: "write",
    requiresWorkspace: true,
    requiresExplicitApproval: false,
    parameters: {
      type: "object",
      properties: { command: stringParam, timeoutMs: numberParam },
      required: ["command"],
      additionalProperties: false,
    },
  },
  {
    name: "run_powershell",
    description: "Run a PowerShell command in the workspace. Same dangerous-command policy as run_command.",
    riskLevel: "write",
    requiresWorkspace: true,
    requiresExplicitApproval: false,
    parameters: {
      type: "object",
      properties: { script: stringParam, timeoutMs: numberParam },
      required: ["script"],
      additionalProperties: false,
    },
  },
  {
    name: "run_npm_script",
    description: "Run an existing package.json script. Never invents scripts.",
    riskLevel: "read",
    requiresWorkspace: true,
    requiresExplicitApproval: false,
    parameters: {
      type: "object",
      properties: { script: stringParam },
      required: ["script"],
      additionalProperties: false,
    },
  },
  {
    name: "run_typecheck",
    description: "Run the repository typecheck script if present.",
    riskLevel: "read",
    requiresWorkspace: true,
    requiresExplicitApproval: false,
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "run_lint",
    description: "Run the repository lint script if present.",
    riskLevel: "read",
    requiresWorkspace: true,
    requiresExplicitApproval: false,
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "run_test",
    description: "Run the repository test script if present. Does not add a test script.",
    riskLevel: "read",
    requiresWorkspace: true,
    requiresExplicitApproval: false,
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "run_build",
    description: "Run the repository build script if present.",
    riskLevel: "read",
    requiresWorkspace: true,
    requiresExplicitApproval: false,
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "inspect_pasted",
    description: "Inspect pasted code when no local workspace is connected. Local files are not required.",
    riskLevel: "read",
    requiresWorkspace: false,
    requiresExplicitApproval: false,
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
] as const;

export function getToolDefinition(name: ToolName): ToolDefinition | undefined {
  return TOOL_CATALOG.find((t) => t.name === name);
}

export function toolsForMode(mode: "pasted" | "workspace" | "vibe"): ToolDefinition[] {
  if (mode === "pasted") {
    return TOOL_CATALOG.filter(
      (t) => t.name === "inspect_pasted" || !t.requiresWorkspace,
    );
  }
  return [...TOOL_CATALOG];
}
