/**
 * Removes build artifacts so quality gates can be verified from a clean state.
 * Does not touch .env, secrets, or source files.
 */
import { rmSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

const targets = [
  join(root, "node_modules"),
  join(root, "apps", "web", ".next"),
  join(root, "apps", "web", "node_modules"),
];

function walk(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (name === "dist" || name === "node_modules" || name === ".next") {
        targets.push(full);
        continue;
      }
      if (name === ".git") continue;
      walk(full);
    } else if (name.endsWith(".tsbuildinfo")) {
      targets.push(full);
    }
  }
}

walk(join(root, "packages"));
walk(join(root, "services"));
walk(join(root, "apps"));

const unique = [...new Set(targets)];
for (const target of unique) {
  if (!existsSync(target)) continue;
  rmSync(target, { recursive: true, force: true });
  console.log(`removed ${target.replace(root + "\\", "").replace(root + "/", "")}`);
}

console.log("clean complete");
