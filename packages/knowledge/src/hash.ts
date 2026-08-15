import { createHash } from "node:crypto";

/** SHA-256 hex digest for change detection / de-duplication. */
export function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * @deprecated Prefer sha256Hex for durable hashes. Kept for lifecycle tests.
 */
export function computeContentHash(content: string): string {
  return sha256Hex(content);
}

export function isDuplicateHash(existing: string[], candidate: string): boolean {
  return existing.includes(candidate);
}

/** NFKC + whitespace normalize for Japanese + Latin knowledge text. */
export function normalizeKnowledgeText(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t\u3000]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
