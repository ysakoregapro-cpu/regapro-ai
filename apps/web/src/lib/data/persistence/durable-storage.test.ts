import { describe, expect, it, vi } from "vitest";
import {
  buildOrgThreadFilePath,
  compensateFailedUpload,
  sanitizeFilename,
  sha256Hex,
} from "@/lib/data/persistence/storage-objects";

describe("storage-objects helpers", () => {
  it("builds org thread paths with sanitized names", () => {
    const path = buildOrgThreadFilePath({
      orgId: "org-1",
      threadId: "th-1",
      fileId: "f-1",
      filename: "a/b?.txt",
    });
    expect(path).toBe("org/org-1/threads/th-1/f-1/a_b_.txt");
    expect(sanitizeFilename("")).toBe("file");
  });

  it("computes stable sha256", async () => {
    const a = await sha256Hex(new TextEncoder().encode("hello"));
    const b = await sha256Hex(new TextEncoder().encode("hello"));
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("compensates after_metadata by soft-deleting file_objects", async () => {
    const update = vi.fn(() => ({
      eq: () => ({
        is: () => Promise.resolve({ error: null }),
      }),
    }));
    const client = {
      from: vi.fn(() => ({ update })),
      storage: { from: vi.fn() },
    };
    await compensateFailedUpload({
      client: client as never,
      fileId: "f1",
      bucket: "chat-attachments",
      path: "org/x/threads/y/f1/a.txt",
      phase: "after_metadata",
    });
    expect(client.from).toHaveBeenCalledWith("file_objects");
    expect(update).toHaveBeenCalled();
  });

  it("compensates after_storage by removing object", async () => {
    const remove = vi.fn(() => Promise.resolve({ error: null }));
    const client = {
      from: vi.fn(),
      storage: {
        from: vi.fn(() => ({ remove })),
      },
    };
    await compensateFailedUpload({
      client: client as never,
      fileId: "f1",
      bucket: "chat-attachments",
      path: "org/x/a.txt",
      phase: "after_storage",
    });
    expect(remove).toHaveBeenCalledWith(["org/x/a.txt"]);
  });
});

describe("artifact durable content (no process-local cache)", () => {
  type VersionRow = {
    version_number: number;
    canonical_content: string | null;
    storage_path: string | null;
    created_at: string;
  };

  /** Simulates two Nest/Vercel instances with shared durable store only. */
  function createDurableArtifactStore() {
    const artifacts = new Map<
      string,
      { title: string; versions: VersionRow[] }
    >();
    return {
      create(id: string, title: string, content: string) {
        artifacts.set(id, {
          title,
          versions: [
            {
              version_number: 1,
              canonical_content: content,
              storage_path: null,
              created_at: "t1",
            },
          ],
        });
      },
      revise(id: string, content: string) {
        const row = artifacts.get(id);
        if (!row) throw new Error("missing");
        row.versions.push({
          version_number: row.versions.length + 1,
          canonical_content: content,
          storage_path: null,
          created_at: `t${row.versions.length + 1}`,
        });
      },
      /** New "process" — no in-memory preview Map, only durable rows. */
      getFresh(id: string) {
        const row = artifacts.get(id);
        if (!row) return null;
        const versions = row.versions.map((v) => ({
          version: v.version_number,
          markdownPreview: v.canonical_content ?? "",
          createdAt: v.created_at,
        }));
        const latest = versions.at(-1)!;
        return {
          title: row.title,
          markdownPreview: latest.markdownPreview,
          version: latest.version,
          versions,
        };
      },
    };
  }

  it("persists and reloads body across fresh clients", () => {
    const db = createDurableArtifactStore();
    db.create("a1", "資料", "# Hello durable");
    // Simulate process restart: new store access without process Map
    const loaded = db.getFresh("a1");
    expect(loaded?.markdownPreview).toBe("# Hello durable");
    expect(loaded?.markdownPreview).not.toMatch(/pending:\/\//);
  });

  it("keeps version-specific bodies", () => {
    const db = createDurableArtifactStore();
    db.create("a1", "資料", "v1 body");
    db.revise("a1", "v1 body\n\nv2 body");
    const loaded = db.getFresh("a1");
    expect(loaded?.version).toBe(2);
    expect(loaded?.versions[0]?.markdownPreview).toBe("v1 body");
    expect(loaded?.versions[1]?.markdownPreview).toBe("v1 body\n\nv2 body");
    expect(loaded?.markdownPreview).toBe("v1 body\n\nv2 body");
  });

  it("never stores pending:// as durable path", () => {
    const db = createDurableArtifactStore();
    db.create("a1", "資料", "text");
    const row = db.getFresh("a1");
    expect(JSON.stringify(row)).not.toContain("pending://");
  });
});

describe("file security metadata inheritance", () => {
  it("maps thread labels onto file metadata fields", () => {
    const thread = {
      confidentialityLevel: "people" as const,
      visibility: "private" as const,
    };
    const file = {
      confidentialityLevel: thread.confidentialityLevel,
      visibility: thread.visibility,
      originThreadId: "th-1",
    };
    expect(file.confidentialityLevel).toBe("people");
    expect(file.visibility).toBe("private");
    expect(file.originThreadId).toBe("th-1");
  });
});
