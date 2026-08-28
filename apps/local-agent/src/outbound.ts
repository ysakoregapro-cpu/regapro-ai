import {
  buildSignedPayload,
  signDevicePayload,
  InProcessToolExecutor,
  assertAllowedWorkspace,
  type ToolCall,
  type ToolObservation,
} from "@regapro/coding-runtime";
import {
  NodeCommandExecutor,
  NodeGit,
  NodeWorkspaceFs,
} from "@regapro/coding-runtime/node";
import { randomUUID } from "node:crypto";
import type { AgentConfig } from "./config.js";

export type CloudCommand = {
  id: string;
  runId: string;
  workspaceRoot: string;
  permission: "read" | "write";
  call: ToolCall;
  approved: boolean;
};

/**
 * Outbound poll: Vercel cannot dial this PC. The agent pulls work.
 */
export async function pollCloudOnce(cfg: AgentConfig): Promise<number> {
  if (!cfg.deviceId) return 0;
  const timestampMs = Date.now();
  const nonce = randomUUID();
  const payload = buildSignedPayload({ deviceId: cfg.deviceId, timestampMs, nonce });
  const signature = signDevicePayload(cfg.privateKeyPem, payload);
  const res = await fetch(`${cfg.cloudBaseUrl.replace(/\/$/, "")}/api/coding/agent/poll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      deviceId: cfg.deviceId,
      timestampMs,
      nonce,
      signature,
    }),
  });
  if (!res.ok) return 0;
  const data = (await res.json()) as { commands?: CloudCommand[] };
  const commands = data.commands ?? [];
  for (const cmd of commands) {
    const observation = await executeCloudCommand(cfg, cmd);
    const timestampMsResult = Date.now();
    const nonceResult = randomUUID();
    const payloadResult = buildSignedPayload({
      deviceId: cfg.deviceId,
      timestampMs: timestampMsResult,
      nonce: nonceResult,
      body: cmd.id,
    });
    await fetch(`${cfg.cloudBaseUrl.replace(/\/$/, "")}/api/coding/agent/result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: cfg.deviceId,
        commandId: cmd.id,
        runId: cmd.runId,
        timestampMs: timestampMsResult,
        nonce: nonceResult,
        signature: signDevicePayload(cfg.privateKeyPem, payloadResult),
        observation,
      }),
    });
  }
  return commands.length;
}

export async function executeCloudCommand(
  cfg: AgentConfig,
  cmd: CloudCommand,
): Promise<ToolObservation> {
  const root = assertAllowedWorkspace(cfg.allowedWorkspaces, cmd.workspaceRoot);
  const permission = cmd.permission === "write" ? "write" : "read";
  const fs = new NodeWorkspaceFs(root, permission);
  const executor = new InProcessToolExecutor({
    fs,
    commands: new NodeCommandExecutor(root),
    git: new NodeGit(root),
  });
  return executor.execute({
    call: cmd.call,
    workspace: {
      id: root,
      deviceId: cfg.deviceId,
      label: cfg.deviceLabel,
      rootPath: root,
      permission,
    },
    pasted: [],
    permission,
    approved: cmd.approved,
  });
}
