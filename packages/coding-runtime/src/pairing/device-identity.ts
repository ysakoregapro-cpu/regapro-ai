import { createHash, generateKeyPairSync, sign as nodeSign, verify as nodeVerify } from "node:crypto";
import { randomInt } from "node:crypto";

export type DeviceKeypair = {
  publicKeyPem: string;
  privateKeyPem: string;
};

export function generateDeviceKeypair(): DeviceKeypair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

export function signDevicePayload(privateKeyPem: string, payload: string): string {
  const buf = nodeSign(null, Buffer.from(payload, "utf8"), privateKeyPem);
  return buf.toString("base64");
}

export function verifyDevicePayload(input: {
  publicKeyPem: string;
  payload: string;
  signatureB64: string;
}): boolean {
  try {
    return nodeVerify(
      null,
      Buffer.from(input.payload, "utf8"),
      input.publicKeyPem,
      Buffer.from(input.signatureB64, "base64"),
    );
  } catch {
    return false;
  }
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generatePairingCode(): string {
  let out = "";
  for (let i = 0; i < 8; i += 1) {
    out += ALPHABET[randomInt(0, ALPHABET.length)];
  }
  return out;
}

export function hashPairingCode(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase(), "utf8").digest("hex");
}

export function buildSignedPayload(input: {
  deviceId: string;
  timestampMs: number;
  nonce: string;
  body?: string;
}): string {
  return `${input.deviceId}.${input.timestampMs}.${input.nonce}.${input.body ?? ""}`;
}

export function isFreshTimestamp(timestampMs: number, now = Date.now(), skewMs = 120_000): boolean {
  return Math.abs(now - timestampMs) <= skewMs;
}
