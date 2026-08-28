import { createHash } from "node:crypto";

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export type PatchApplyResult = {
  ok: boolean;
  next: string;
  reason: string | null;
};

function stripPatchFences(patch: string): string {
  return patch
    .replace(/^\s*```(?:diff|patch)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

/**
 * Apply a focused patch. Preferred formats:
 * 1) Search/replace hunks: lines starting with `<<<<` / `====` / `>>>>`
 * 2) Cursor-style *** Begin Patch / *** Update File
 * 3) Unified diff hunks with @@ 
 */
export function applyPatchToContent(original: string, patch: string): PatchApplyResult {
  const body = stripPatchFences(patch);
  if (!body) return { ok: false, next: original, reason: "EMPTY_PATCH" };

  const searchReplace = applySearchReplace(original, body);
  if (searchReplace.ok || searchReplace.reason !== "NOT_SEARCH_REPLACE") {
    return searchReplace;
  }

  const begin = applyBeginPatch(original, body);
  if (begin.ok || begin.reason !== "NOT_BEGIN_PATCH") {
    return begin;
  }

  return applyUnifiedHunks(original, body);
}

function applySearchReplace(original: string, body: string): PatchApplyResult {
  if (!body.includes("<<<<") || !body.includes(">>>>")) {
    return { ok: false, next: original, reason: "NOT_SEARCH_REPLACE" };
  }
  const chunks = [...body.matchAll(/<<<<\n([\s\S]*?)====\n([\s\S]*?)>>>>/g)];
  if (chunks.length === 0) {
    return { ok: false, next: original, reason: "MALFORMED_SEARCH_REPLACE" };
  }
  let next = original;
  for (const chunk of chunks) {
    const oldText = chunk[1] ?? "";
    const newText = chunk[2] ?? "";
    if (!next.includes(oldText)) {
      return { ok: false, next: original, reason: "CONTEXT_NOT_FOUND" };
    }
    next = next.replace(oldText, newText);
  }
  return { ok: true, next, reason: null };
}

function applyBeginPatch(original: string, body: string): PatchApplyResult {
  if (!body.includes("*** Begin Patch") && !body.includes("*** Update File:")) {
    return { ok: false, next: original, reason: "NOT_BEGIN_PATCH" };
  }
  const hunks = body.split("@@").slice(1);
  if (hunks.length === 0) {
    const lines = body.split(/\r?\n/).filter((l) => l.startsWith("-") || l.startsWith("+") || l.startsWith(" "));
    return applyLineOps(original, lines);
  }
  let next = original;
  for (const hunk of hunks) {
    const ops = hunk
      .split(/\r?\n/)
      .slice(1)
      .filter((l) => l.startsWith("-") || l.startsWith("+") || l.startsWith(" "));
    const result = applyLineOps(next, ops);
    if (!result.ok) return result;
    next = result.next;
  }
  return { ok: true, next, reason: null };
}

function applyLineOps(original: string, ops: string[]): PatchApplyResult {
  const oldLines: string[] = [];
  const newLines: string[] = [];
  for (const op of ops) {
    if (op.startsWith("***")) continue;
    const ch = op[0];
    const rest = op.slice(1);
    if (ch === " ") {
      oldLines.push(rest);
      newLines.push(rest);
    } else if (ch === "-") {
      oldLines.push(rest);
    } else if (ch === "+") {
      newLines.push(rest);
    }
  }
  const oldBlock = oldLines.join("\n");
  const newBlock = newLines.join("\n");
  if (!oldBlock) {
    return { ok: true, next: original + (original.endsWith("\n") ? "" : "\n") + newBlock, reason: null };
  }
  if (!original.includes(oldBlock)) {
    return { ok: false, next: original, reason: "CONTEXT_NOT_FOUND" };
  }
  return { ok: true, next: original.replace(oldBlock, newBlock), reason: null };
}

function applyUnifiedHunks(original: string, body: string): PatchApplyResult {
  if (!body.includes("@@")) {
    return { ok: false, next: original, reason: "UNSUPPORTED_PATCH" };
  }
  const hunks = body.split("@@").slice(1);
  let next = original;
  for (const hunk of hunks) {
    const lines = hunk.split(/\r?\n/).slice(1);
    const ops = lines.filter((l) => l.startsWith("-") || l.startsWith("+") || l.startsWith(" "));
    const result = applyLineOps(next, ops);
    if (!result.ok) return result;
    next = result.next;
  }
  return { ok: true, next, reason: null };
}
