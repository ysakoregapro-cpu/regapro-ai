import http from "node:http";
import {
  InProcessToolExecutor,
  assertAllowedWorkspace,
  type ToolCall,
  type ToolName,
  type WorkspacePermission,
} from "@regapro/coding-runtime";
import {
  NodeWorkspaceFs,
  NodeCommandExecutor,
  NodeGit,
} from "@regapro/coding-runtime/node";
import type { AgentConfig } from "./config.js";

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function authorizeLocal(req: http.IncomingMessage, token: string): boolean {
  const header = req.headers.authorization ?? "";
  return header === `Bearer ${token}`;
}

export function createLocalBridgeServer(input: {
  config: AgentConfig;
  token: string;
}): http.Server {
  return http.createServer((req, res) => {
    void (async () => {
      if (req.socket.remoteAddress && !["127.0.0.1", "::1", ":ffff:127.0.0.1"].includes(req.socket.remoteAddress)) {
        json(res, 403, { ok: false, error: "LOCALHOST_ONLY" });
        return;
      }
      if (!authorizeLocal(req, input.token)) {
        json(res, 401, { ok: false, error: "UNAUTHORIZED" });
        return;
      }
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/health") {
        json(res, 200, {
          ok: true,
          deviceLabel: input.config.deviceLabel,
          workspaces: input.config.allowedWorkspaces,
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/tool") {
        const body = (await readBody(req)) as {
          workspaceRoot?: string;
          permission?: WorkspacePermission;
          call?: { id: string; name: ToolName; arguments: Record<string, unknown> };
        };
        const root = assertAllowedWorkspace(
          input.config.allowedWorkspaces,
          body.workspaceRoot ?? "",
        );
        const permission = body.permission === "write" ? "write" : "read";
        const fs = new NodeWorkspaceFs(root, permission);
        const executor = new InProcessToolExecutor({
          fs,
          commands: new NodeCommandExecutor(root),
          git: new NodeGit(root),
          allowedWorkspaces: input.config.allowedWorkspaces.map((p) => ({
            id: p,
            deviceId: input.config.deviceId,
            label: p,
            rootPath: p,
            permission,
          })),
        });
        const call = body.call as ToolCall;
        const observation = await executor.execute({
          call,
          workspace: {
            id: root,
            deviceId: input.config.deviceId,
            label: input.config.deviceLabel,
            rootPath: root,
            permission,
          },
          pasted: [],
          permission,
          approved: false,
        });
        json(res, 200, { ok: true, observation });
        return;
      }
      json(res, 404, { ok: false, error: "NOT_FOUND" });
    })().catch((err) => {
      json(res, 500, { ok: false, error: err instanceof Error ? err.message : "ERROR" });
    });
  });
}
