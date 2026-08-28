import "server-only";
import {
  generatePairingCode,
  hashPairingCode,
  isFreshTimestamp,
  verifyDevicePayload,
  buildSignedPayload,
  type DeviceRef,
  type ToolCall,
  type ToolObservation,
  type WorkspaceRef,
} from "@regapro/coding-runtime";

type PairingChallenge = {
  orgId: string;
  userId: string;
  codeHash: string;
  expiresAt: number;
};

type StoredDevice = DeviceRef & {
  orgId: string;
  userId: string;
  publicKeyPem: string;
};

type QueuedCommand = {
  id: string;
  deviceId: string;
  runId: string;
  workspaceRoot: string;
  permission: "read" | "write";
  call: ToolCall;
  approved: boolean;
};

const challenges: PairingChallenge[] = [];
const devices: StoredDevice[] = [];
const workspaces: Array<WorkspaceRef & { orgId: string; userId: string }> = [];
const queue: QueuedCommand[] = [];
const results = new Map<string, ToolObservation>();

function gc(): void {
  const now = Date.now();
  for (let i = challenges.length - 1; i >= 0; i -= 1) {
    if ((challenges[i]?.expiresAt ?? 0) < now) challenges.splice(i, 1);
  }
}

export function startPairing(input: { orgId: string; userId: string }): {
  pairingCode: string;
  expiresAt: string;
} {
  gc();
  const pairingCode = generatePairingCode();
  challenges.push({
    orgId: input.orgId,
    userId: input.userId,
    codeHash: hashPairingCode(pairingCode),
    expiresAt: Date.now() + 10 * 60_000,
  });
  return { pairingCode, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() };
}

export function redeemPairing(input: {
  pairingCode: string;
  publicKeyPem: string;
  deviceLabel: string;
  os: DeviceRef["os"];
}): { deviceId: string; status: "pending" } | { error: string } {
  gc();
  const hash = hashPairingCode(input.pairingCode);
  const ch = challenges.find((c) => c.codeHash === hash);
  if (!ch) return { error: "INVALID_OR_EXPIRED_CODE" };
  const deviceId = globalThis.crypto.randomUUID();
  devices.push({
    id: deviceId,
    label: input.deviceLabel || "NOTEBOOK",
    os: input.os,
    status: "pending",
    orgId: ch.orgId,
    userId: ch.userId,
    publicKeyPem: input.publicKeyPem,
  });
  return { deviceId, status: "pending" };
}

export function confirmDevice(input: {
  userId: string;
  orgId: string;
  deviceId: string;
}): boolean {
  const d = devices.find(
    (x) => x.id === input.deviceId && x.userId === input.userId && x.orgId === input.orgId,
  );
  if (!d) return false;
  d.status = "paired";
  return true;
}

export function revokeDevice(input: { userId: string; orgId: string; deviceId: string }): boolean {
  const d = devices.find(
    (x) => x.id === input.deviceId && x.orgId === input.orgId && x.userId === input.userId,
  );
  if (!d) return false;
  d.status = "revoked";
  return true;
}

export function listDevicesForUser(userId: string, orgId: string): DeviceRef[] {
  return devices
    .filter((d) => d.userId === userId && d.orgId === orgId)
    .map((d) => ({
      id: d.id,
      label: d.label,
      os: d.os,
      status: d.status,
    }));
}

export function addWorkspace(input: {
  userId: string;
  orgId: string;
  deviceId: string;
  rootPath: string;
  permission: "read" | "write";
  label: string;
}): WorkspaceRef | null {
  const d = devices.find(
    (x) => x.id === input.deviceId && x.userId === input.userId && x.orgId === input.orgId && x.status === "paired",
  );
  if (!d) return null;
  const ws: WorkspaceRef & { orgId: string; userId: string } = {
    id: globalThis.crypto.randomUUID(),
    deviceId: d.id,
    label: input.label,
    rootPath: input.rootPath,
    permission: input.permission,
    orgId: input.orgId,
    userId: input.userId,
  };
  workspaces.push(ws);
  return ws;
}

export function verifyAgentRequest(input: {
  deviceId: string;
  timestampMs: number;
  nonce: string;
  signature: string;
  body?: string;
}): StoredDevice | null {
  const d = devices.find((x) => x.id === input.deviceId && x.status === "paired");
  if (!d) return null;
  if (!isFreshTimestamp(input.timestampMs)) return null;
  const payload = buildSignedPayload({
    deviceId: input.deviceId,
    timestampMs: input.timestampMs,
    nonce: input.nonce,
    body: input.body,
  });
  const ok = verifyDevicePayload({
    publicKeyPem: d.publicKeyPem,
    payload,
    signatureB64: input.signature,
  });
  return ok ? d : null;
}

export function enqueueCommand(cmd: QueuedCommand): void {
  queue.push(cmd);
}

export function claimCommands(deviceId: string): QueuedCommand[] {
  const claimed: QueuedCommand[] = [];
  for (let i = queue.length - 1; i >= 0; i -= 1) {
    if (queue[i]?.deviceId === deviceId) {
      claimed.push(queue[i]!);
      queue.splice(i, 1);
    }
  }
  return claimed.reverse();
}

export function storeResult(commandId: string, observation: ToolObservation): void {
  results.set(commandId, observation);
}

export function codingStatus(userId: string, orgId: string) {
  return {
    devices: listDevicesForUser(userId, orgId),
    workspaces: workspaces
      .filter((w) => w.userId === userId && w.orgId === orgId)
      .map((w) => ({
        id: w.id,
        deviceId: w.deviceId,
        label: w.label,
        rootPath: w.rootPath,
        permission: w.permission,
      })),
  };
}
