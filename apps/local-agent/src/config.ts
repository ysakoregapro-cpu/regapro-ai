import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  generateDeviceKeypair,
  isProbablyUnrestrictedRoot,
  type DeviceKeypair,
} from "@regapro/coding-runtime";

export type AgentConfig = {
  deviceId: string | null;
  deviceLabel: string;
  publicKeyPem: string;
  privateKeyPem: string;
  cloudBaseUrl: string;
  allowedWorkspaces: string[];
  listenHost: "127.0.0.1";
  listenPort: number;
};

export function configDir(): string {
  return path.join(os.homedir(), ".regapro", "local-agent");
}

export function configPath(): string {
  return path.join(configDir(), "config.json");
}

export function defaultConfig(): AgentConfig {
  const keys: DeviceKeypair = generateDeviceKeypair();
  return {
    deviceId: null,
    deviceLabel: os.hostname() || "NOTEBOOK",
    publicKeyPem: keys.publicKeyPem,
    privateKeyPem: keys.privateKeyPem,
    cloudBaseUrl: process.env.REGAPRO_CLOUD_URL?.trim() || "http://127.0.0.1:3000",
    allowedWorkspaces: [],
    listenHost: "127.0.0.1",
    listenPort: Number(process.env.REGAPRO_LOCAL_AGENT_PORT ?? 47831),
  };
}

export function loadConfig(): AgentConfig {
  const p = configPath();
  if (!fs.existsSync(p)) return defaultConfig();
  const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<AgentConfig>;
  const base = defaultConfig();
  return {
    ...base,
    ...parsed,
    listenHost: "127.0.0.1",
    privateKeyPem: parsed.privateKeyPem ?? base.privateKeyPem,
    publicKeyPem: parsed.publicKeyPem ?? base.publicKeyPem,
  };
}

export function saveConfig(cfg: AgentConfig): void {
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), { encoding: "utf8", mode: 0o600 });
}

export function addWorkspace(cfg: AgentConfig, rootPath: string): AgentConfig {
  const resolved = path.resolve(rootPath);
  if (isProbablyUnrestrictedRoot(resolved)) {
    throw new Error("WORKSPACE_TOO_BROAD");
  }
  if (cfg.allowedWorkspaces.some((w) => path.resolve(w) === resolved)) return cfg;
  return { ...cfg, allowedWorkspaces: [...cfg.allowedWorkspaces, resolved] };
}
