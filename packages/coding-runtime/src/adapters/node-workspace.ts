import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { SKIP_DIR } from "../context/workspace-snapshot.js";
import { resolveInsideWorkspace } from "../permissions/workspace-boundary.js";
import { isSecretPath, maskSecrets, secretFilePlaceholder } from "../secrets/mask.js";
import type {
  CommandExecutorPort,
  CommandResult,
  GitPort,
  ReadFileResult,
  WorkspaceFsPort,
  WorkspaceFsStat,
} from "../ports.js";
import type { WorkspacePermission } from "../types.js";

function fileHash(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export class NodeWorkspaceFs implements WorkspaceFsPort {
  constructor(
    readonly rootPath: string,
    readonly permission: WorkspacePermission,
    private readonly maxFileBytes = 200_000,
  ) {}

  private abs(relativePath: string): string {
    return resolveInsideWorkspace(this.rootPath, relativePath);
  }

  async list(relativeDir: string, maxEntries = 120): Promise<WorkspaceFsStat[]> {
    const dir = this.abs(relativeDir);
    const out: WorkspaceFsStat[] = [];
    const walk = async (current: string): Promise<void> => {
      if (out.length >= maxEntries) return;
      let names: string[];
      try {
        names = await fs.readdir(current);
      } catch {
        return;
      }
      for (const name of names) {
        if (SKIP_DIR.has(name)) continue;
        if (out.length >= maxEntries) return;
        const full = path.join(current, name);
        const rel = path.relative(this.rootPath, full).replace(/\\/g, "/");
        try {
          const st = await fs.lstat(full);
          if (st.isSymbolicLink()) continue;
          if (st.isDirectory()) {
            out.push({ path: rel, kind: "directory", size: 0 });
            await walk(full);
          } else {
            out.push({ path: rel, kind: "file", size: st.size });
          }
        } catch {
          continue;
        }
      }
    };
    await walk(dir);
    return out;
  }

  async read(
    relativePath: string,
    range?: { startLine: number; endLine: number },
    opts?: { mask?: boolean },
  ): Promise<ReadFileResult> {
    const abs = this.abs(relativePath);
    const rel = path.relative(this.rootPath, abs).replace(/\\/g, "/");
    const mask = opts?.mask !== false;
    if (mask && isSecretPath(rel)) {
      let hash = "";
      try {
        hash = fileHash(await fs.readFile(abs));
      } catch {
        hash = "";
      }
      return {
        path: rel,
        content: secretFilePlaceholder(rel),
        hash,
        truncated: false,
        secretMasked: true,
        bytes: 0,
      };
    }
    const buf = await fs.readFile(abs);
    const hash = fileHash(buf);
    const raw = buf.toString("utf8");
    const masked = mask ? maskSecrets(raw) : { text: raw, masked: false };
    let content = masked.text;
    let truncated = false;
    if (content.length > this.maxFileBytes) {
      content = `${content.slice(0, this.maxFileBytes)}\n…[truncated]`;
      truncated = true;
    }
    if (range) {
      const lines = content.split(/\r?\n/);
      content = lines.slice(Math.max(0, range.startLine - 1), range.endLine).join("\n");
    }
    return {
      path: rel,
      content,
      hash,
      truncated,
      secretMasked: masked.masked,
      bytes: buf.length,
    };
  }

  async write(
    relativePath: string,
    content: string,
    expectedHash?: string | null,
  ): Promise<{ hash: string; created: boolean; stale: boolean }> {
    const abs = this.abs(relativePath);
    let existing: Buffer | null = null;
    try {
      existing = await fs.readFile(abs);
    } catch {
      existing = null;
    }
    if (expectedHash && existing) {
      const current = fileHash(existing);
      if (current !== expectedHash) {
        return { hash: current, created: false, stale: true };
      }
    }
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
    return {
      hash: fileHash(Buffer.from(content, "utf8")),
      created: existing === null,
      stale: false,
    };
  }

  async rename(fromRelative: string, toRelative: string): Promise<void> {
    const from = this.abs(fromRelative);
    const to = this.abs(toRelative);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.rename(from, to);
  }

  async exists(relativePath: string): Promise<boolean> {
    try {
      await fs.access(this.abs(relativePath));
      return true;
    } catch {
      return false;
    }
  }

  async hash(relativePath: string): Promise<string | null> {
    try {
      return fileHash(await fs.readFile(this.abs(relativePath)));
    } catch {
      return null;
    }
  }
}

export async function runProcess(input: {
  argv: string[];
  cwd: string;
  timeoutMs: number;
  shell?: boolean;
}): Promise<CommandResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(input.argv[0] ?? "true", input.argv.slice(1), {
      cwd: input.cwd,
      shell: input.shell ?? false,
      windowsHide: true,
      env: { ...process.env },
    });
    let stdout = "";
    let stderr = "";
    const max = 64_000;
    child.stdout?.on("data", (d: Buffer) => {
      if (stdout.length < max) stdout += d.toString("utf8");
    });
    child.stderr?.on("data", (d: Buffer) => {
      if (stderr.length < max) stderr += d.toString("utf8");
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, input.timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      const truncated = stdout.length >= max || stderr.length >= max;
      resolve({
        ok: code === 0,
        exitCode: code,
        stdout,
        stderr,
        truncated,
        durationMs: Date.now() - started,
        blockedReason: null,
      });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        exitCode: null,
        stdout,
        stderr: err.message,
        truncated: false,
        durationMs: Date.now() - started,
        blockedReason: "SPAWN_FAILED",
      });
    });
  });
}

export class NodeCommandExecutor implements CommandExecutorPort {
  constructor(private readonly rootPath: string) {}

  async run(input: {
    argv: string[];
    cwdRelative?: string;
    timeoutMs: number;
    shell?: "none" | "powershell";
  }): Promise<CommandResult> {
    const cwd = resolveInsideWorkspace(this.rootPath, input.cwdRelative ?? ".");
    if (input.shell === "powershell") {
      return runProcess({
        argv: ["powershell", "-NoProfile", "-NonInteractive", "-Command", input.argv.join(" ")],
        cwd,
        timeoutMs: input.timeoutMs,
        shell: false,
      });
    }
    return runProcess({
      argv: input.argv,
      cwd,
      timeoutMs: input.timeoutMs,
      shell: false,
    });
  }
}

export class NodeGit implements GitPort {
  constructor(private readonly rootPath: string) {}

  private git(args: string[], timeoutMs = 15_000) {
    return runProcess({ argv: ["git", ...args], cwd: this.rootPath, timeoutMs, shell: false });
  }

  async status() {
    const branch = await this.git(["rev-parse", "--abbrev-ref", "HEAD"]);
    const porcelain = await this.git(["status", "--porcelain=v1"]);
    const isRepo = porcelain.blockedReason !== "SPAWN_FAILED" && !/not a git repository/i.test(porcelain.stderr);
    return {
      porcelain: porcelain.stdout,
      branch: branch.ok ? branch.stdout.trim() : null,
      isRepo,
    };
  }

  async diff(args?: { staged?: boolean; path?: string }) {
    const argv = ["diff"];
    if (args?.staged) argv.push("--cached");
    if (args?.path) argv.push("--", args.path);
    const r = await this.git(argv);
    return r.stdout || r.stderr;
  }

  async log(limit = 8) {
    const r = await this.git(["log", `-${limit}`, "--oneline"]);
    return r.stdout;
  }

  async branchList() {
    const r = await this.git(["branch", "--list"]);
    return r.stdout;
  }

  async checkout(branch: string, create: boolean) {
    if (branch.startsWith("-") || branch.includes("..")) {
      return {
        ok: false,
        exitCode: 1,
        stdout: "",
        stderr: "INVALID_BRANCH",
        truncated: false,
        durationMs: 0,
        blockedReason: "INVALID_BRANCH",
      };
    }
    return this.git(create ? ["checkout", "-b", branch] : ["checkout", branch]);
  }

  async add(paths: string[]) {
    const safe = paths.map((p) => path.relative(this.rootPath, resolveInsideWorkspace(this.rootPath, p)));
    return this.git(["add", "--", ...safe]);
  }
}
