import { describe, expect, it } from "vitest";

/**
 * Pure helpers mirror citation-persistence unauthorized stripping.
 */
function stripUnauthorizedCitation(input: {
  chunkId: string | null;
  excerpt: string | null;
  title: string;
  readableChunkIds: Set<string>;
}) {
  if (input.chunkId && !input.readableChunkIds.has(input.chunkId)) {
    return {
      title: input.title,
      excerpt: null,
      chunkId: null,
      documentId: null,
    };
  }
  return {
    title: input.title,
    excerpt: input.excerpt,
    chunkId: input.chunkId,
    documentId: "doc-1",
  };
}

describe("citation unauthorized content", () => {
  it("drops excerpt when chunk is no longer readable", () => {
    const view = stripUnauthorizedCitation({
      chunkId: "c-secret",
      excerpt: "機密給与情報",
      title: "給与規程",
      readableChunkIds: new Set(),
    });
    expect(view.excerpt).toBeNull();
    expect(view.chunkId).toBeNull();
    expect(view.title).toBe("給与規程");
  });

  it("keeps excerpt when chunk remains readable", () => {
    const view = stripUnauthorizedCitation({
      chunkId: "c1",
      excerpt: "公開手順",
      title: "手順書",
      readableChunkIds: new Set(["c1"]),
    });
    expect(view.excerpt).toBe("公開手順");
    expect(view.chunkId).toBe("c1");
  });
});
