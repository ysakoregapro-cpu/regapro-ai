import { describe, expect, it } from "vitest";
import {
  generateDeviceKeypair,
  generatePairingCode,
  hashPairingCode,
  signDevicePayload,
  verifyDevicePayload,
  isFreshTimestamp,
} from "./device-identity.js";

describe("device pairing crypto", () => {
  it("signs and verifies with Ed25519 and never needs service_role on the device", () => {
    const keys = generateDeviceKeypair();
    const payload = "device-1.123.nonce.";
    const sig = signDevicePayload(keys.privateKeyPem, payload);
    expect(verifyDevicePayload({ publicKeyPem: keys.publicKeyPem, payload, signatureB64: sig })).toBe(
      true,
    );
    expect(
      verifyDevicePayload({
        publicKeyPem: keys.publicKeyPem,
        payload: payload + "tamper",
        signatureB64: sig,
      }),
    ).toBe(false);
  });

  it("hashes pairing codes and checks timestamp freshness", () => {
    const code = generatePairingCode();
    expect(code).toHaveLength(8);
    expect(hashPairingCode(code)).toHaveLength(64);
    expect(hashPairingCode(code)).toBe(hashPairingCode(code.toLowerCase()));
    expect(isFreshTimestamp(Date.now())).toBe(true);
    expect(isFreshTimestamp(Date.now() - 10 * 60_000)).toBe(false);
  });
});
