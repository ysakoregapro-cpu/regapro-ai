import path from "node:path";

export class WorkspaceBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceBoundaryError";
  }
}

function samePath(a: string, b: string): boolean {
  if (process.platform === "win32") {
    return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  }
  return path.resolve(a) === path.resolve(b);
}

/**
 * Resolve a user-supplied relative path inside an allowed workspace root.
 * Rejects absolute paths, other drives, NUL, and `..` traversal.
 */
export function resolveInsideWorkspace(rootPath: string, relativePath: string): string {
  const root = path.resolve(rootPath);
  if (!relativePath || relativePath.trim() === "" || relativePath === ".") {
    return root;
  }
  const raw = relativePath.replace(/\0/g, "");
  if (
    raw.includes("\0") ||
    /^[a-zA-Z]:[\\/]/.test(raw) ||
    raw.startsWith("\\\\") ||
    path.isAbsolute(raw)
  ) {
    throw new WorkspaceBoundaryError("PATH_OUTSIDE_WORKSPACE");
  }
  const candidate = path.resolve(root, raw);
  const rel = path.relative(root, candidate);
  if (!rel) return candidate;
  const relPosix = rel.replace(/\\/g, "/");
  if (relPosix === ".." || relPosix.startsWith("../") || path.isAbsolute(rel)) {
    throw new WorkspaceBoundaryError("PATH_OUTSIDE_WORKSPACE");
  }
  return candidate;
}

export function assertAllowedWorkspace(
  allowedRoots: readonly string[],
  candidateRoot: string,
): string {
  const resolved = path.resolve(candidateRoot);
  for (const allowed of allowedRoots) {
    if (samePath(allowed, resolved)) return path.resolve(allowed);
  }
  throw new WorkspaceBoundaryError("WORKSPACE_NOT_ALLOWED");
}

export function isProbablyUnrestrictedRoot(rootPath: string): boolean {
  const n = path.resolve(rootPath);
  if (process.platform === "win32") {
    return /^[a-zA-Z]:\\?$/.test(n);
  }
  return n === "/" || n === "/Users" || n === "/home";
}
