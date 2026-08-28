import { describe, expect, it } from "vitest";
import {
  WorkspaceBoundaryError,
  assertAllowedWorkspace,
  isProbablyUnrestrictedRoot,
  resolveInsideWorkspace,
} from "./workspace-boundary.js";

describe("workspace boundary", () => {
  const root =
    process.platform === "win32" ? "C:\\Users\\natan\\source\\regapro-expense" : "/Users/natan/source/regapro-expense";

  it("resolves relative files inside the workspace", () => {
    const resolved = resolveInsideWorkspace(root, "src/app.ts");
    expect(resolved.toLowerCase()).toContain("regapro-expense");
    expect(resolved).toMatch(/app\.ts$/);
  });

  it("rejects parent traversal", () => {
    expect(() => resolveInsideWorkspace(root, "..\\..\\Windows\\System32")).toThrow(
      WorkspaceBoundaryError,
    );
    expect(() => resolveInsideWorkspace(root, "../../etc/passwd")).toThrow(WorkspaceBoundaryError);
  });

  it("rejects absolute paths and other drives", () => {
    expect(() => resolveInsideWorkspace(root, "C:\\\\Users\\\\natan\\\\source\\\\other")).toThrow(
      WorkspaceBoundaryError,
    );
    expect(() => resolveInsideWorkspace(root, "/etc/passwd")).toThrow(WorkspaceBoundaryError);
  });

  it("does not allow C:\\ as a workspace", () => {
    expect(isProbablyUnrestrictedRoot("C:\\")).toBe(true);
    expect(isProbablyUnrestrictedRoot(root)).toBe(false);
    expect(() => assertAllowedWorkspace([root], root + "-other")).toThrow(WorkspaceBoundaryError);
    expect(assertAllowedWorkspace([root], root)).toBeTruthy();
  });
});
