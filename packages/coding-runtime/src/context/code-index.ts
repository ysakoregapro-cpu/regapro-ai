import type { CodeIndexPort } from "../ports.js";
import { SKIP_DIR, buildWorkspaceSnapshot } from "./workspace-snapshot.js";

/**
 * Default lexical index. Replace with AST / embeddings / symbol index later
 * without changing the Agent Loop.
 */
export class LexicalCodeIndex implements CodeIndexPort {
  async snapshot(workspace: Parameters<CodeIndexPort["snapshot"]>[0]) {
    return buildWorkspaceSnapshot(workspace);
  }

  async search(input: Parameters<CodeIndexPort["search"]>[0]) {
    const { workspace, query, maxResults = 20 } = input;
    const hits: Array<{ path: string; line: number; excerpt: string }> = [];
    const entries = await workspace.list(".", 200);
    const needle = query.toLowerCase();
    for (const entry of entries) {
      if (entry.kind !== "file") continue;
      const top = entry.path.split(/[/\\]/)[0] ?? "";
      if (SKIP_DIR.has(top)) continue;
      if (input.glob && !entry.path.includes(input.glob.replace(/^\*\*\//, ""))) {
        continue;
      }
      let content: string;
      try {
        content = (await workspace.read(entry.path)).content;
      } catch {
        continue;
      }
      const lines = content.split(/\r?\n/);
      lines.forEach((line, idx) => {
        if (hits.length >= maxResults) return;
        if (line.toLowerCase().includes(needle)) {
          hits.push({
            path: entry.path,
            line: idx + 1,
            excerpt: line.trim().slice(0, 200),
          });
        }
      });
      if (hits.length >= maxResults) break;
    }
    return hits;
  }
}
