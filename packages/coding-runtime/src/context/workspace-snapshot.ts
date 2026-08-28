import type { WorkspaceFsPort } from "../ports.js";

const SKIP_DIR = new Set([
  "node_modules",
  ".git",
  "dist",
  ".next",
  "coverage",
  ".turbo",
  "out",
]);

const CONFIG_NAMES = new Set([
  "package.json",
  "tsconfig.json",
  "tsconfig.build.json",
  "next.config.ts",
  "next.config.js",
  "vitest.config.ts",
  "playwright.config.ts",
  "eslint.config.mjs",
  ".gitignore",
]);

export type WorkspaceSnapshot = {
  tree: string;
  packageMetadata: string | null;
  configs: string[];
};

/**
 * Cheap first-look context. Not a full repo dump.
 * CodeIndexPort can later swap in lexical / AST / embeddings / symbols.
 */
export async function buildWorkspaceSnapshot(
  fs: WorkspaceFsPort,
  maxEntries = 80,
): Promise<WorkspaceSnapshot> {
  const entries = await fs.list(".", maxEntries);
  const tree = entries
    .filter((e) => !SKIP_DIR.has(e.path.split(/[/\\]/)[0] ?? ""))
    .slice(0, maxEntries)
    .map((e) => `${e.kind === "directory" ? "d" : "f"} ${e.path}`)
    .join("\n");

  let packageMetadata: string | null = null;
  if (await fs.exists("package.json")) {
    const pkg = await fs.read("package.json");
    packageMetadata = summarizePackageJson(pkg.content);
  }

  const configs: string[] = [];
  for (const name of CONFIG_NAMES) {
    if (await fs.exists(name)) configs.push(name);
  }

  return { tree, packageMetadata, configs };
}

export function summarizePackageJson(raw: string): string {
  try {
    const json = JSON.parse(raw) as {
      name?: string;
      scripts?: Record<string, string>;
      workspaces?: unknown;
    };
    const scripts = Object.keys(json.scripts ?? {});
    return JSON.stringify({
      name: json.name ?? null,
      scripts,
      workspaces: Boolean(json.workspaces),
    });
  } catch {
    return raw.slice(0, 400);
  }
}

export { SKIP_DIR };
