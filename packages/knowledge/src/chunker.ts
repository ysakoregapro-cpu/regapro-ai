import { normalizeKnowledgeText, sha256Hex } from "./hash.js";

export type ChunkDraft = {
  chunkIndex: number;
  content: string;
  contentNormalized: string;
  contentHash: string;
  tokenCount: number;
};

export type ChunkerOptions = {
  /** Soft max characters per chunk (UTF-16 length). Default 900. */
  maxChars?: number;
  /** Overlap with previous chunk. Default 120. */
  overlapChars?: number;
  /** Merge tiny trailing fragments below this size. Default 80. */
  minChars?: number;
};

const HEADING_RE = /^(#{1,6}\s+\S.+|[【「].+[】」]\s*$|[一二三四五六七八九十]+[、.．]\s*\S.+)/u;
const SENTENCE_END_RE = /(?<=[。！？!?．.])\s*/u;

function approxTokenCount(text: string): number {
  // Japanese-heavy heuristic: ~1.8 chars per token-ish unit.
  return Math.max(1, Math.ceil(text.length / 1.8));
}

/**
 * Split preferring headings → blank paragraphs → sentence ends → hard cut.
 * Deterministic for the same body + options.
 */
export function splitKnowledgeBody(
  body: string,
  options: ChunkerOptions = {},
): ChunkDraft[] {
  const maxChars = options.maxChars ?? 900;
  const overlapChars = options.overlapChars ?? 120;
  const minChars = options.minChars ?? 80;
  const normalizedBody = normalizeKnowledgeText(body);
  if (!normalizedBody) return [];

  const paragraphs = normalizedBody
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const units: string[] = [];
  for (const para of paragraphs) {
    if (para.length <= maxChars) {
      units.push(para);
      continue;
    }
    // Sentence split for long paragraphs.
    const sentences = para.split(SENTENCE_END_RE).filter((s) => s.trim());
    let buf = "";
    for (const sentence of sentences) {
      const next = buf ? `${buf}${sentence}` : sentence;
      if (next.length > maxChars && buf) {
        units.push(buf.trim());
        buf = sentence;
      } else {
        buf = next;
      }
    }
    if (buf.trim()) units.push(buf.trim());
  }

  // Merge heading + following unit when heading is short.
  const merged: string[] = [];
  for (let i = 0; i < units.length; i++) {
    const u = units[i]!;
    if (HEADING_RE.test(u) && u.length < maxChars / 2 && units[i + 1]) {
      const combined = `${u}\n\n${units[i + 1]}`;
      if (combined.length <= maxChars) {
        merged.push(combined);
        i += 1;
        continue;
      }
    }
    merged.push(u);
  }

  const chunks: ChunkDraft[] = [];
  let carry = "";
  for (const unit of merged) {
    let piece = carry ? `${carry}\n\n${unit}` : unit;
    carry = "";
    while (piece.length > maxChars) {
      let cut = piece.lastIndexOf("\n", maxChars);
      if (cut < maxChars * 0.4) cut = piece.lastIndexOf("。", maxChars);
      if (cut < maxChars * 0.4) cut = maxChars;
      const head = piece.slice(0, cut).trim();
      if (head) {
        chunks.push(toDraft(chunks.length, head));
        const overlapStart = Math.max(0, head.length - overlapChars);
        carry = head.slice(overlapStart);
      }
      piece = piece.slice(cut).trim();
      if (carry && piece) {
        piece = `${carry}\n\n${piece}`;
        carry = "";
      }
    }
    if (piece) {
      if (piece.length < minChars && chunks.length > 0) {
        const prev = chunks[chunks.length - 1]!;
        const combined = `${prev.content}\n\n${piece}`;
        chunks[chunks.length - 1] = toDraft(prev.chunkIndex, combined);
      } else {
        chunks.push(toDraft(chunks.length, piece));
        if (overlapChars > 0) {
          carry = piece.slice(Math.max(0, piece.length - overlapChars));
        }
      }
    }
  }

  // Re-index after merges.
  return chunks.map((c, i) => toDraft(i, c.content));
}

function toDraft(chunkIndex: number, content: string): ChunkDraft {
  const contentNormalized = normalizeKnowledgeText(content);
  return {
    chunkIndex,
    content: contentNormalized,
    contentNormalized,
    contentHash: sha256Hex(contentNormalized),
    tokenCount: approxTokenCount(contentNormalized),
  };
}

/**
 * Plans upserts so re-ingesting the same body does not create infinite duplicates.
 * Existing chunks keyed by content_hash (same version) are kept; obsolete soft-deleted.
 */
export function planChunkUpserts(input: {
  drafts: ChunkDraft[];
  existing: Array<{ id: string; contentHash: string; chunkIndex: number }>;
}): {
  toUpsert: ChunkDraft[];
  toSoftDeleteIds: string[];
  unchangedIds: string[];
} {
  const byHash = new Map(input.existing.map((e) => [e.contentHash, e]));
  const seenHashes = new Set<string>();
  const toUpsert: ChunkDraft[] = [];
  const unchangedIds: string[] = [];

  for (const draft of input.drafts) {
    if (seenHashes.has(draft.contentHash)) continue;
    seenHashes.add(draft.contentHash);
    const hit = byHash.get(draft.contentHash);
    if (hit && hit.chunkIndex === draft.chunkIndex) {
      unchangedIds.push(hit.id);
    } else {
      toUpsert.push(draft);
    }
  }

  const keep = new Set([...unchangedIds, ...toUpsert.map(() => "")]);
  void keep;
  const draftHashSet = new Set(input.drafts.map((d) => d.contentHash));
  const toSoftDeleteIds = input.existing
    .filter((e) => !draftHashSet.has(e.contentHash))
    .map((e) => e.id);

  return { toUpsert, toSoftDeleteIds, unchangedIds };
}
