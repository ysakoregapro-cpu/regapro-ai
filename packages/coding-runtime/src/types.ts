/** Coding modes exposed to IntentRouter / Assistant. */
export type CodingMode = "pasted" | "workspace" | "vibe";

export type CodingLanguage =
  | "javascript"
  | "typescript"
  | "tsx"
  | "python"
  | "sql"
  | "powershell"
  | "gas"
  | "react"
  | "unknown";

export type ToolRiskLevel = "read" | "write" | "dangerous";

export type WorkspacePermission = "read" | "write";

export type CodingRunStatus =
  | "queued"
  | "planning"
  | "running"
  | "awaiting_approval"
  | "verifying"
  | "completed"
  | "failed"
  | "stopped"
  | "needs_device";

export type DeviceStatus = "pending" | "paired" | "revoked";

export type CodingModelRole = "fast" | "main" | "reasoning" | "code";

export type ToolName =
  | "workspace_list"
  | "workspace_info"
  | "list_directory"
  | "read_file"
  | "read_file_range"
  | "search_files"
  | "find_text"
  | "git_status"
  | "git_diff"
  | "git_log"
  | "git_branch"
  | "git_checkout"
  | "git_add"
  | "write_file"
  | "create_file"
  | "apply_patch"
  | "rename_file"
  | "run_command"
  | "run_powershell"
  | "run_npm_script"
  | "run_typecheck"
  | "run_lint"
  | "run_test"
  | "run_build"
  | "inspect_pasted";

export type ToolDefinition = {
  name: ToolName;
  description: string;
  riskLevel: ToolRiskLevel;
  requiresWorkspace: boolean;
  /** When true, never auto-run even if workspace is WRITE. */
  requiresExplicitApproval: boolean;
  parameters: Record<string, unknown>;
};

export type ToolCall = {
  id: string;
  name: ToolName;
  arguments: Record<string, unknown>;
};

export type ToolObservation = {
  callId: string;
  name: ToolName;
  ok: boolean;
  riskLevel: ToolRiskLevel;
  truncated: boolean;
  /** Safe payload for the model. Secrets already masked. */
  output: string;
  metadata: {
    durationMs: number;
    bytes: number;
    path?: string;
    changed?: boolean;
    approvalRequired?: boolean;
    blockedReason?: string | null;
  };
};

export type CodingBudget = {
  maxIterations: number;
  maxToolCalls: number;
  maxMillis: number;
  maxCostUsd: number;
  maxObservationChars: number;
  maxFileBytes: number;
};

export const DEFAULT_CODING_BUDGET: CodingBudget = {
  maxIterations: 18,
  maxToolCalls: 40,
  maxMillis: 180_000,
  maxCostUsd: 2.5,
  maxObservationChars: 8_000,
  maxFileBytes: 200_000,
};

export type CodingIntentDecision = {
  isCoding: boolean;
  mode: CodingMode | null;
  language: CodingLanguage | null;
  reason: string;
  confidence: number;
  requiresWorkspace: boolean;
  /** Pasted blocks extracted from the utterance. Empty when none. */
  pastedBlocks: PastedCodeBlock[];
};

export type PastedCodeBlock = {
  language: CodingLanguage;
  filenameHint: string;
  code: string;
};

export type WorkspaceRef = {
  id: string;
  deviceId: string | null;
  label: string;
  rootPath: string;
  permission: WorkspacePermission;
};

export type DeviceRef = {
  id: string;
  label: string;
  os: "windows" | "macos" | "linux" | "unknown";
  status: DeviceStatus;
};

export type CodingPlan = {
  goal: string;
  mode: CodingMode;
  steps: string[];
  primaryRole: CodingModelRole;
  secondaryRole: CodingModelRole | null;
  needInternalKnowledge: boolean;
  needWorkspace: boolean;
  verification: string[];
};

export type FileChange = {
  path: string;
  action: "create" | "update" | "rename" | "delete_requested";
  beforeHash: string | null;
  afterHash: string | null;
};

export type VerificationResult = {
  detected: Array<"typecheck" | "lint" | "test" | "build">;
  ran: Array<"typecheck" | "lint" | "test" | "build">;
  passed: boolean;
  summary: string;
};

export type GitSnapshot = {
  isRepo: boolean;
  branch: string | null;
  porcelain: string;
  /** Paths dirty before the agent started. Never reset these. */
  preExistingDirty: string[];
  agentTouched: string[];
  diffStat: string;
};

export type CodingStep = {
  iteration: number;
  kind: "plan" | "tool" | "reason" | "verify" | "finish" | "approval";
  summary: string;
  toolName?: ToolName;
  status: "ok" | "blocked" | "error";
};

export type CodingRunResult = {
  runId: string;
  status: CodingRunStatus;
  mode: CodingMode;
  plan: CodingPlan;
  text: string;
  steps: CodingStep[];
  changedFiles: FileChange[];
  verification: VerificationResult | null;
  git: GitSnapshot | null;
  limitations: string[];
  modelRole: CodingModelRole;
  modelId: string;
  iterations: number;
  toolCalls: number;
  latencyMs: number;
  estimatedCostUsd: number | null;
  pendingApprovals: ApprovalRequest[];
};

export type ApprovalRequest = {
  id: string;
  toolName: ToolName;
  riskLevel: ToolRiskLevel;
  summary: string;
  argumentsPreview: string;
};

export type CodingTrace = {
  intent: "code";
  mode: CodingMode;
  modelRole: CodingModelRole;
  modelId: string;
  toolNames: ToolName[];
  iterations: number;
  toolCalls: number;
  latencyMs: number;
  success: boolean;
  failureStage: string | null;
  estimatedCostUsd: number | null;
};

export type KnowledgeSnippet = {
  title: string;
  excerpt: string;
};
