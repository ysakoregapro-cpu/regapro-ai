export type DirtyClassification = {
  preExisting: string[];
  agentTouched: string[];
  overlap: string[];
};

export function parsePorcelain(porcelain: string): string[] {
  return porcelain
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .map((l) => l.slice(3).trim())
    .filter(Boolean);
}

/**
 * Keep user dirty files distinct from agent edits. Never treat overlap as
 * license to reset.
 */
export function classifyDirtyState(input: {
  beforePaths: readonly string[];
  afterPaths: readonly string[];
  agentTouched: readonly string[];
}): DirtyClassification {
  const before = new Set(input.beforePaths);
  const agent = new Set(input.agentTouched);
  const after = new Set(input.afterPaths);
  const preExisting = [...before];
  const agentTouched = [...agent].filter((p) => after.has(p) || before.has(p) || true);
  const overlap = [...agent].filter((p) => before.has(p));
  return { preExisting, agentTouched, overlap };
}

export function formatGitSnapshotNotice(input: DirtyClassification): string {
  const lines = [];
  if (input.preExisting.length) {
    lines.push(
      `開始前から未コミットの変更があります（${input.preExisting.length}件）。これらはリセットしません。`,
    );
  }
  if (input.overlap.length) {
    lines.push(
      `AIが触ったパスと既存の未コミット変更が重なっています: ${input.overlap.join(", ")}`,
    );
  }
  return lines.join("\n");
}
