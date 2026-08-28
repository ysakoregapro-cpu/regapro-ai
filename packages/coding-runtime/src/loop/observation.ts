import { redactObservation } from "../secrets/mask.js";
import type { ToolObservation } from "../types.js";

const MAX_IDENTICAL = 2;

export class FailureGuard {
  private readonly signatures = new Map<string, number>();

  note(obs: ToolObservation): { repeat: boolean; signature: string } {
    const signature = `${obs.name}:${obs.ok}:${obs.metadata.blockedReason ?? ""}:${obs.output.slice(0, 180)}`;
    const count = (this.signatures.get(signature) ?? 0) + 1;
    this.signatures.set(signature, count);
    return { repeat: count > MAX_IDENTICAL, signature };
  }

  hint(signature: string): string {
    return `同じ失敗を繰り返しています（${signature}）。別の読み取り・別パッチ・検証コマンドの見直しに切り替えてください。`;
  }
}

export function observationForModel(
  obs: ToolObservation,
  maxChars: number,
): string {
  const redacted = redactObservation(obs.output, maxChars);
  const header = [
    `tool=${obs.name}`,
    `ok=${obs.ok}`,
    obs.truncated || redacted.truncated ? "truncated=true" : null,
    obs.metadata.approvalRequired ? "approvalRequired=true" : null,
    obs.metadata.blockedReason ? `blocked=${obs.metadata.blockedReason}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return `${header}\n${redacted.text}`;
}
