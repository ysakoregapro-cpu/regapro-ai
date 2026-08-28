import { sha256 } from "../patch/apply-patch.js";
import { resolveInsideWorkspace } from "../permissions/workspace-boundary.js";
import { isSecretPath, maskSecrets, secretFilePlaceholder } from "../secrets/mask.js";
import type { ReadFileResult, WorkspaceFsPort, WorkspaceFsStat } from "../ports.js";
import type { WorkspacePermission } from "../types.js";

function toPosix(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

export class MemoryWorkspaceFs implements WorkspaceFsPort {
  readonly files = new Map<string, string>();

  constructor(
    readonly rootPath: string,
    readonly permission: WorkspacePermission,
    initial?: Record<string, string>,
  ) {
    if (initial) {
      for (const [k, v] of Object.entries(initial)) {
        this.files.set(toPosix(k), v);
      }
    }
  }

  private key(relativePath: string): string {
    resolveInsideWorkspace(this.rootPath, relativePath);
    return toPosix(relativePath);
  }

  async list(relativeDir: string, maxEntries = 100): Promise<WorkspaceFsStat[]> {
    const prefix = toPosix(relativeDir === "." ? "" : relativeDir);
    const out: WorkspaceFsStat[] = [];
    for (const filePath of this.files.keys()) {
      if (prefix && filePath !== prefix && !filePath.startsWith(`${prefix}/`)) continue;
      out.push({
        path: filePath,
        kind: "file",
        size: this.files.get(filePath)?.length ?? 0,
        hash: sha256(this.files.get(filePath) ?? ""),
      });
      if (out.length >= maxEntries) break;
    }
    return out;
  }

  async read(
    relativePath: string,
    range?: { startLine: number; endLine: number },
    opts?: { mask?: boolean },
  ): Promise<ReadFileResult> {
    const key = this.key(relativePath);
    const mask = opts?.mask !== false;
    if (mask && isSecretPath(key)) {
      return {
        path: key,
        content: secretFilePlaceholder(key),
        hash: sha256(this.files.get(key) ?? ""),
        truncated: false,
        secretMasked: true,
        bytes: 0,
      };
    }
    const raw = this.files.get(key);
    if (raw === undefined) {
      throw new Error("FILE_NOT_FOUND");
    }
    const masked = mask ? maskSecrets(raw) : { text: raw, masked: false };
    let content = masked.text;
    if (range) {
      const lines = content.split(/\r?\n/);
      content = lines.slice(Math.max(0, range.startLine - 1), range.endLine).join("\n");
    }
    return {
      path: key,
      content,
      hash: sha256(raw),
      truncated: false,
      secretMasked: masked.masked,
      bytes: raw.length,
    };
  }

  async write(
    relativePath: string,
    content: string,
    expectedHash?: string | null,
  ): Promise<{ hash: string; created: boolean; stale: boolean }> {
    const key = this.key(relativePath);
    const existing = this.files.get(key);
    if (expectedHash && existing !== undefined && sha256(existing) !== expectedHash) {
      return { hash: sha256(existing), created: false, stale: true };
    }
    const created = existing === undefined;
    this.files.set(key, content);
    return { hash: sha256(content), created, stale: false };
  }

  async rename(fromRelative: string, toRelative: string): Promise<void> {
    const from = this.key(fromRelative);
    const to = this.key(toRelative);
    const content = this.files.get(from);
    if (content === undefined) throw new Error("FILE_NOT_FOUND");
    this.files.set(to, content);
    this.files.delete(from);
  }

  async exists(relativePath: string): Promise<boolean> {
    return this.files.has(this.key(relativePath));
  }

  async hash(relativePath: string): Promise<string | null> {
    const content = this.files.get(this.key(relativePath));
    return content === undefined ? null : sha256(content);
  }
}

export function virtualPastedRoot(): string {
  return process.platform === "win32" ? "C:\\regapro-pasted" : "/tmp/regapro-pasted";
}

export function seedPastedWorkspace(
  files: Record<string, string>,
): MemoryWorkspaceFs {
  return new MemoryWorkspaceFs(virtualPastedRoot(), "write", files);
}
