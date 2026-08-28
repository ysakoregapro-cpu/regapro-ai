import type { AccessContext } from "@regapro/security";
import type {
  ApprovalRequest,
  CodingBudget,
  CodingMode,
  CodingModelRole,
  CodingRunResult,
  DeviceRef,
  KnowledgeSnippet,
  PastedCodeBlock,
  ToolCall,
  ToolDefinition,
  ToolName,
  ToolObservation,
  WorkspacePermission,
  WorkspaceRef,
} from "./types.js";

export type { CodingChatMessage } from "./loop-messages.js";

export type CodingModelTurnInput = {
  messages: import("./loop-messages.js").CodingChatMessage[];
  tools: ToolDefinition[];
  role: CodingModelRole;
  abortSignal?: AbortSignal;
};

export type CodingModelTurnOutput = {
  text: string | null;
  toolCalls: ToolCall[];
  modelId: string;
  role: CodingModelRole;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
  estimatedCostUsd?: number | null;
};

export type CodingModelPort = {
  complete(input: CodingModelTurnInput): Promise<CodingModelTurnOutput>;
};

export type WorkspaceFsStat = {
  path: string;
  kind: "file" | "directory";
  size: number;
  hash?: string;
};

export type ReadFileResult = {
  path: string;
  content: string;
  hash: string;
  truncated: boolean;
  secretMasked: boolean;
  bytes: number;
};

export type WorkspaceFsPort = {
  readonly rootPath: string;
  readonly permission: WorkspacePermission;
  list(relativeDir: string, maxEntries?: number): Promise<WorkspaceFsStat[]>;
  read(
    relativePath: string,
    range?: { startLine: number; endLine: number },
    opts?: { mask?: boolean },
  ): Promise<ReadFileResult>;
  write(relativePath: string, content: string, expectedHash?: string | null): Promise<{
    hash: string;
    created: boolean;
    stale: boolean;
  }>;
  rename(fromRelative: string, toRelative: string): Promise<void>;
  exists(relativePath: string): Promise<boolean>;
  hash(relativePath: string): Promise<string | null>;
};

export type CommandResult = {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
  blockedReason: string | null;
};

export type CommandExecutorPort = {
  run(input: {
    argv: string[];
    cwdRelative?: string;
    timeoutMs: number;
    shell?: "none" | "powershell";
  }): Promise<CommandResult>;
};

export type GitPort = {
  status(): Promise<{ porcelain: string; branch: string | null; isRepo: boolean }>;
  diff(args?: { staged?: boolean; path?: string }): Promise<string>;
  log(limit?: number): Promise<string>;
  branchList(): Promise<string>;
  checkout(branch: string, create: boolean): Promise<CommandResult>;
  add(paths: string[]): Promise<CommandResult>;
};

export type ApprovalPort = {
  isApproved(input: { runId: string; toolName: ToolName; fingerprint: string }): Promise<boolean>;
  request(input: ApprovalRequest & { runId: string; fingerprint: string }): Promise<void>;
};

export type CodingRunStorePort = {
  save(result: {
    runId: string;
    orgId: string;
    userId: string;
    threadId: string | null;
    goal: string;
    mode: CodingMode;
    deviceId: string | null;
    workspaceId: string | null;
    status: CodingRunResult["status"];
    plan: unknown;
    toolNames: ToolName[];
    changedFiles: string[];
    verification: unknown;
    startedAt: string;
    finishedAt: string | null;
  }): Promise<void>;
};

export type ToolExecutorPort = {
  execute(input: {
    call: ToolCall;
    workspace: WorkspaceRef | null;
    pasted: PastedCodeBlock[];
    permission: WorkspacePermission;
    approved: boolean;
  }): Promise<ToolObservation>;
};

export type CodeIndexPort = {
  snapshot(workspace: WorkspaceFsPort): Promise<{
    tree: string;
    packageMetadata: string | null;
    configs: string[];
  }>;
  search(input: {
    workspace: WorkspaceFsPort;
    query: string;
    glob?: string;
    maxResults?: number;
  }): Promise<Array<{ path: string; line: number; excerpt: string }>>;
};

export type DeviceTransportPort = {
  listDevices(userId: string, orgId: string): Promise<DeviceRef[]>;
  listWorkspaces(deviceId: string): Promise<WorkspaceRef[]>;
  enqueue(input: {
    deviceId: string;
    runId: string;
    call: ToolCall;
  }): Promise<ToolObservation>;
};

export type CodingRuntimeInput = {
  access: AccessContext;
  runId: string;
  threadId: string | null;
  userText: string;
  mode?: CodingMode | null;
  workspace: WorkspaceRef | null;
  device: DeviceRef | null;
  pasted?: PastedCodeBlock[];
  knowledge?: KnowledgeSnippet[];
  budget?: Partial<CodingBudget>;
  abortSignal?: AbortSignal;
  autoApproveWrite?: boolean;
};

export type CodingRuntimePort = {
  run(input: CodingRuntimeInput): Promise<CodingRunResult>;
};
