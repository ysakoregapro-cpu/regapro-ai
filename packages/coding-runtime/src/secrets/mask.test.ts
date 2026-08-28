import { describe, expect, it } from "vitest";
import { isSecretPath, maskSecrets, redactObservation } from "./mask.js";

describe("secret masking", () => {
  it("detects secret filenames", () => {
    expect(isSecretPath(".env")).toBe(true);
    expect(isSecretPath(".env.local")).toBe(true);
    expect(isSecretPath("id_rsa")).toBe(true);
    expect(isSecretPath("src/index.ts")).toBe(false);
  });

  it("redacts tokens and env assignments", () => {
    const masked = maskSecrets(
      "token=sk-abcdefghijklmnopqrstuvwxyz\nAI_GATEWAY_API_KEY=abc\nplain=ok",
    );
    expect(masked.masked).toBe(true);
    expect(masked.text).not.toMatch(/sk-abcdefghijklmnopqrstuvwxyz/);
    expect(masked.text).toMatch(/\[REDACTED\]/);
    expect(masked.text).toMatch(/plain=ok/);
  });

  it("truncates huge logs for the model", () => {
    const r = redactObservation("x".repeat(50), 10);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThan(40);
  });
});
