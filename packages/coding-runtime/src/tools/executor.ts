import { SKIP_DIR } from "../context/workspace-snapshot.js";
import { summarizePackageJson } from "../context/workspace-snapshot.js";
import { applyPatchToContent } from "../patch/apply-patch.js";
import { classifyCommandRisk, toolRequiresExplicitApproval } from "../permissions/risk.js";
import { WorkspaceBoundaryError } from "../permissions/workspace-boundary.js";
import { isSecretPath, redactObservation, secretFilePlaceholder } from "../secrets/mask.js";
import { getToolDefinition } from "../tools/catalog.js";
import { detectQualityGates } from "../verification/detect-gates.js";
import type {
  CommandExecutorPort,
  GitPort,
  ToolExecutorPort,
  WorkspaceFsPort,
} from "../ports.js";
import type {
  PastedCodeBlock,
  ToolCall,
  ToolObservation,
  WorkspacePermission,
  WorkspaceRef,
} from "../types.js";

function obs(input: {
  call: ToolCall;
  ok: boolean;
  output: string;
  durationMs: number;
  path?: string;
  changed?: boolean;
  approvalRequired?: boolean;
  blockedReason?: string | null;
  maxChars?: number;
}): ToolObservation {
  const def = getToolDefinition(input.call.name);
  const redacted = redactObservation(input.output, input.maxChars ?? 8_000);
  return {
    callId: input.call.id,
    name: input.call.name,
    ok: input.ok,
    riskLevel: def?.riskLevel ?? "dangerous",
    truncated: redacted.truncated,
    output: redacted.text,
    metadata: {
      durationMs: input.durationMs,
      bytes: redacted.text.length,
      path: input.path,
      changed: input.changed,
      approvalRequired: input.approvalRequired,
      blockedReason: input.blockedReason ?? null,
    },
  };
}

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  return typeof v === "string" ? v : "";
}

function parseArgv(command: string): string[] {
  const matches = command.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  return matches.map((m) => m.replace(/^"|"$/g, ""));
}

export class InProcessToolExecutor implements ToolExecutorPort {
  constructor(
    private readonly deps: {
      fs: WorkspaceFsPort | null;
      commands: CommandExecutorPort | null;
      git: GitPort | null;
      allowedWorkspaces?: WorkspaceRef[];
      maxObservationChars?: number;
    },
  ) {}

  async execute(input: {
    call: ToolCall;
    workspace: WorkspaceRef | null;
    pasted: PastedCodeBlock[];
    permission: WorkspacePermission;
    approved: boolean;
  }): Promise<ToolObservation> {
    const started = Date.now();
    const def = getToolDefinition(input.call.name);
    if (!def) {
      return obs({
        call: input.call,
        ok: false,
        output: "UNKNOWN_TOOL",
        durationMs: 0,
        blockedReason: "UNKNOWN_TOOL",
      });
    }

    if (def.requiresWorkspace && !this.deps.fs) {
      if (input.call.name !== "inspect_pasted" && input.pasted.length > 0) {
        return obs({
          call: input.call,
          ok: false,
          output:
            "ローカルWorkspaceは未接続です。貼られたコードは inspect_pasted と生成結果で扱えます。ファイルが無いこと自体はエラーではありません。",
          durationMs: Date.now() - started,
          blockedReason: "NO_WORKSPACE",
        });
      }
      return obs({
        call: input.call,
        ok: false,
        output: "NO_WORKSPACE",
        durationMs: Date.now() - started,
        blockedReason: "NO_WORKSPACE",
      });
    }

    if (def.riskLevel === "write" && input.permission !== "write") {
      return obs({
        call: input.call,
        ok: false,
        output: "WRITE_NOT_PERMITTED このWorkspaceは READ のみです。",
        durationMs: Date.now() - started,
        blockedReason: "WRITE_NOT_PERMITTED",
      });
    }

    const cmdText =
      input.call.name === "run_command"
        ? str(input.call.arguments, "command")
        : input.call.name === "run_powershell"
          ? str(input.call.arguments, "script")
          : "";
    const commandRisk = cmdText ? classifyCommandRisk(cmdText) : null;
    const needsApproval =
      def.requiresExplicitApproval ||
      def.riskLevel === "dangerous" ||
      Boolean(commandRisk?.autoForbidden) ||
      toolRequiresExplicitApproval(input.call.name, input.call.arguments);
    if (needsApproval && !input.approved) {
      return obs({
        call: input.call,
        ok: false,
        output: `APPROVAL_REQUIRED ${commandRisk?.reason ?? "dangerous"} 危険操作は自動実行しません。`,
        durationMs: Date.now() - started,
        approvalRequired: true,
        blockedReason: commandRisk?.reason ?? "APPROVAL_REQUIRED",
      });
    }

    try {
      return await this.dispatch(input, started);
    } catch (err) {
      const message =
        err instanceof WorkspaceBoundaryError
          ? "PATH_OUTSIDE_WORKSPACE"
          : err instanceof Error
            ? err.message
            : "TOOL_FAILED";
      return obs({
        call: input.call,
        ok: false,
        output: message,
        durationMs: Date.now() - started,
        blockedReason: message,
      });
    }
  }

  private async dispatch(
    input: {
      call: ToolCall;
      workspace: WorkspaceRef | null;
      pasted: PastedCodeBlock[];
      permission: WorkspacePermission;
      approved: boolean;
    },
    started: number,
  ): Promise<ToolObservation> {
    const args = input.call.arguments;
    const fs = this.deps.fs;
    const git = this.deps.git;
    const commands = this.deps.commands;
    const name = input.call.name;
    const elapsed = () => Date.now() - started;

    if (name === "workspace_list") {
      const list = (this.deps.allowedWorkspaces ?? (input.workspace ? [input.workspace] : []))
        .map((w) => `${w.label}: ${w.rootPath} (${w.permission})`)
        .join("\n");
      return obs({
        call: input.call,
        ok: true,
        output: list || "許可されたWorkspaceはありません。",
        durationMs: elapsed(),
      });
    }

    if (name === "inspect_pasted") {
      if (input.pasted.length === 0) {
        return obs({
          call: input.call,
          ok: true,
          output: "貼られたコードはありません。ローカルファイルは不要です。",
          durationMs: elapsed(),
        });
      }
      const body = input.pasted
        .map(
          (b, i) =>
            `--- pasted ${i + 1} (${b.language} / ${b.filenameHint}) ---\n${b.code}`,
        )
        .join("\n\n");
      return obs({ call: input.call, ok: true, output: body, durationMs: elapsed() });
    }

    if (!fs) {
      return obs({
        call: input.call,
        ok: false,
        output: "NO_WORKSPACE",
        durationMs: elapsed(),
        blockedReason: "NO_WORKSPACE",
      });
    }

    if (name === "workspace_info") {
      const pkg = (await fs.exists("package.json"))
        ? summarizePackageJson((await fs.read("package.json")).content)
        : "no package.json";
      const status = git ? await git.status() : { isRepo: false, branch: null, porcelain: "" };
      return obs({
        call: input.call,
        ok: true,
        output: JSON.stringify({
          root: fs.rootPath,
          permission: fs.permission,
          package: pkg,
          git: status,
        }),
        durationMs: elapsed(),
      });
    }

    if (name === "list_directory") {
      const rows = await fs.list(str(args, "path") || ".");
      return obs({
        call: input.call,
        ok: true,
        output: rows.map((r) => `${r.kind}\t${r.path}`).join("\n"),
        durationMs: elapsed(),
      });
    }

    if (name === "read_file" || name === "read_file_range") {
      const p = str(args, "path");
      const range =
        name === "read_file_range"
          ? {
              startLine: Number(args.startLine ?? 1),
              endLine: Number(args.endLine ?? 1),
            }
          : undefined;
      const file = await fs.read(p, range);
      return obs({
        call: input.call,
        ok: true,
        output: `hash=${file.hash}\n${file.content}`,
        durationMs: elapsed(),
        path: p,
      });
    }

    if (name === "search_files") {
      const query = str(args, "query").toLowerCase();
      const entries = await fs.list(".", 200);
      const hits = entries
        .filter((e) => e.path.toLowerCase().includes(query))
        .map((e) => e.path);
      return obs({
        call: input.call,
        ok: true,
        output: hits.join("\n") || "(no files)",
        durationMs: elapsed(),
      });
    }

    if (name === "find_text") {
      const query = str(args, "query");
      const entries = await fs.list(".", 200);
      const hits: string[] = [];
      for (const e of entries) {
        if (e.kind !== "file") continue;
        const top = e.path.split(/[/\\]/)[0] ?? "";
        if (SKIP_DIR.has(top)) continue;
        try {
          const file = await fs.read(e.path);
          file.content.split(/\r?\n/).forEach((line, idx) => {
            if (hits.length >= 30) return;
            if (line.includes(query)) hits.push(`${e.path}:${idx + 1}:${line.trim().slice(0, 160)}`);
          });
        } catch {
          continue;
        }
      }
      return obs({
        call: input.call,
        ok: true,
        output: hits.join("\n") || "(no hits)",
        durationMs: elapsed(),
      });
    }

    if (name === "git_status") {
      if (!git) return obs({ call: input.call, ok: false, output: "GIT_UNAVAILABLE", durationMs: elapsed() });
      const s = await git.status();
      return obs({
        call: input.call,
        ok: true,
        output: `branch=${s.branch}\nrepo=${s.isRepo}\n${s.porcelain}`,
        durationMs: elapsed(),
      });
    }

    if (name === "git_diff") {
      if (!git) return obs({ call: input.call, ok: false, output: "GIT_UNAVAILABLE", durationMs: elapsed() });
      const diff = await git.diff({
        staged: Boolean(args.staged),
        path: str(args, "path") || undefined,
      });
      const masked = isSecretPath(str(args, "path")) ? secretFilePlaceholder(str(args, "path")) : diff;
      return obs({ call: input.call, ok: true, output: masked || "(empty diff)", durationMs: elapsed() });
    }

    if (name === "git_log") {
      if (!git) return obs({ call: input.call, ok: false, output: "GIT_UNAVAILABLE", durationMs: elapsed() });
      return obs({
        call: input.call,
        ok: true,
        output: await git.log(Number(args.limit ?? 8)),
        durationMs: elapsed(),
      });
    }

    if (name === "git_branch") {
      if (!git) return obs({ call: input.call, ok: false, output: "GIT_UNAVAILABLE", durationMs: elapsed() });
      return obs({ call: input.call, ok: true, output: await git.branchList(), durationMs: elapsed() });
    }

    if (name === "git_checkout") {
      if (!git) return obs({ call: input.call, ok: false, output: "GIT_UNAVAILABLE", durationMs: elapsed() });
      const r = await git.checkout(str(args, "branch"), Boolean(args.create));
      return obs({
        call: input.call,
        ok: r.ok,
        output: r.stdout || r.stderr,
        durationMs: elapsed(),
        blockedReason: r.blockedReason,
      });
    }

    if (name === "git_add") {
      if (!git) return obs({ call: input.call, ok: false, output: "GIT_UNAVAILABLE", durationMs: elapsed() });
      const paths = Array.isArray(args.paths) ? args.paths.map(String) : [];
      const r = await git.add(paths);
      return obs({
        call: input.call,
        ok: r.ok,
        output: r.stdout || r.stderr || "staged",
        durationMs: elapsed(),
        changed: r.ok,
      });
    }

    if (name === "create_file" || name === "write_file") {
      const p = str(args, "path");
      if (isSecretPath(p) && !input.approved) {
        return obs({
          call: input.call,
          ok: false,
          output: "SECRET_WRITE_REQUIRES_APPROVAL",
          durationMs: elapsed(),
          approvalRequired: true,
          blockedReason: "SECRET_WRITE_REQUIRES_APPROVAL",
          path: p,
        });
      }
      if (name === "create_file" && (await fs.exists(p))) {
        return obs({
          call: input.call,
          ok: false,
          output: "FILE_EXISTS",
          durationMs: elapsed(),
          path: p,
          blockedReason: "FILE_EXISTS",
        });
      }
      const result = await fs.write(
        p,
        str(args, "content"),
        name === "write_file" ? str(args, "expectedHash") || null : null,
      );
      if (result.stale) {
        return obs({
          call: input.call,
          ok: false,
          output: `STALE_FILE hash=${result.hash} 再readしてください。`,
          durationMs: elapsed(),
          path: p,
          blockedReason: "STALE_FILE",
        });
      }
      return obs({
        call: input.call,
        ok: true,
        output: `wrote ${p} hash=${result.hash}`,
        durationMs: elapsed(),
        path: p,
        changed: true,
      });
    }

    if (name === "apply_patch") {
      const p = str(args, "path");
      if (!p) {
        return obs({
          call: input.call,
          ok: false,
          output: "PATH_REQUIRED",
          durationMs: elapsed(),
          blockedReason: "PATH_REQUIRED",
        });
      }
      if (isSecretPath(p) && !input.approved) {
        return obs({
          call: input.call,
          ok: false,
          output: "SECRET_WRITE_REQUIRES_APPROVAL",
          durationMs: elapsed(),
          approvalRequired: true,
          blockedReason: "SECRET_WRITE_REQUIRES_APPROVAL",
          path: p,
        });
      }
      const current = await fs.read(p, undefined, { mask: false });
      const expected = str(args, "expectedHash");
      if (expected && current.hash !== expected) {
        return obs({
          call: input.call,
          ok: false,
          output: `STALE_FILE hash=${current.hash} 再readしてください。`,
          durationMs: elapsed(),
          path: p,
          blockedReason: "STALE_FILE",
        });
      }
      const patched = applyPatchToContent(current.content, str(args, "patch"));
      if (!patched.ok) {
        return obs({
          call: input.call,
          ok: false,
          output: patched.reason ?? "PATCH_FAILED",
          durationMs: elapsed(),
          path: p,
          blockedReason: patched.reason,
        });
      }
      const written = await fs.write(p, patched.next, current.hash);
      if (written.stale) {
        return obs({
          call: input.call,
          ok: false,
          output: "STALE_FILE",
          durationMs: elapsed(),
          path: p,
          blockedReason: "STALE_FILE",
        });
      }
      return obs({
        call: input.call,
        ok: true,
        output: `patched ${p} hash=${written.hash}`,
        durationMs: elapsed(),
        path: p,
        changed: true,
      });
    }

    if (name === "rename_file") {
      await fs.rename(str(args, "from"), str(args, "to"));
      return obs({
        call: input.call,
        ok: true,
        output: `renamed ${str(args, "from")} -> ${str(args, "to")}`,
        durationMs: elapsed(),
        changed: true,
        path: str(args, "to"),
      });
    }

    if (
      name === "run_command" ||
      name === "run_powershell" ||
      name === "run_npm_script" ||
      name === "run_typecheck" ||
      name === "run_lint" ||
      name === "run_test" ||
      name === "run_build"
    ) {
      if (!commands) {
        return obs({
          call: input.call,
          ok: false,
          output: "COMMANDS_UNAVAILABLE",
          durationMs: elapsed(),
          blockedReason: "COMMANDS_UNAVAILABLE",
        });
      }
      return this.runDetectedCommand(input, started);
    }

    return obs({
      call: input.call,
      ok: false,
      output: "UNIMPLEMENTED_TOOL",
      durationMs: elapsed(),
      blockedReason: "UNIMPLEMENTED_TOOL",
    });
  }

  private async runDetectedCommand(
    input: {
      call: ToolCall;
      approved: boolean;
    },
    started: number,
  ): Promise<ToolObservation> {
    const fs = this.deps.fs;
    const commands = this.deps.commands;
    if (!fs || !commands) {
      return obs({
        call: input.call,
        ok: false,
        output: "COMMANDS_UNAVAILABLE",
        durationMs: Date.now() - started,
        blockedReason: "COMMANDS_UNAVAILABLE",
      });
    }
    const name = input.call.name;
    const args = input.call.arguments;
    let argv: string[] = [];
    let shell: "none" | "powershell" = "none";
    let commandText = "";

    if (name === "run_command") {
      commandText = str(args, "command");
      const risk = classifyCommandRisk(commandText);
      if (risk.autoForbidden && !input.approved) {
        return obs({
          call: input.call,
          ok: false,
          output: `BLOCKED ${risk.reason}`,
          durationMs: Date.now() - started,
          approvalRequired: true,
          blockedReason: risk.reason,
        });
      }
      argv = parseArgv(commandText);
      if (process.platform === "win32" && argv[0] === "npm") {
        argv = ["npm.cmd", ...argv.slice(1)];
      }
    } else if (name === "run_powershell") {
      commandText = str(args, "script");
      const risk = classifyCommandRisk(commandText);
      if (risk.autoForbidden && !input.approved) {
        return obs({
          call: input.call,
          ok: false,
          output: `BLOCKED ${risk.reason}`,
          durationMs: Date.now() - started,
          approvalRequired: true,
          blockedReason: risk.reason,
        });
      }
      shell = "powershell";
      argv = [commandText];
    } else {
      let pkg: string | null = null;
      if (await fs.exists("package.json")) {
        pkg = (await fs.read("package.json")).content;
      }
      const gates = detectQualityGates(pkg);
      const wanted =
        name === "run_npm_script"
          ? str(args, "script")
          : name.replace("run_", "");
      if (name !== "run_npm_script" && !gates.includes(wanted as (typeof gates)[number])) {
        return obs({
          call: input.call,
          ok: true,
          output: `NO_SCRIPT ${wanted} 既存の package.json を書き換えず、未定義の検証はスキップします。`,
          durationMs: Date.now() - started,
        });
      }
      if (name === "run_npm_script") {
        let scripts: Record<string, string> = {};
        try {
          scripts = (JSON.parse(pkg ?? "{}") as { scripts?: Record<string, string> }).scripts ?? {};
        } catch {
          scripts = {};
        }
        if (!scripts[wanted]) {
          return obs({
            call: input.call,
            ok: false,
            output: `UNKNOWN_SCRIPT ${wanted}`,
            durationMs: Date.now() - started,
            blockedReason: "UNKNOWN_SCRIPT",
          });
        }
      }
      argv = process.platform === "win32" ? ["npm.cmd", "run", wanted] : ["npm", "run", wanted];
    }

    const result = await commands.run({
      argv,
      timeoutMs: Number(args.timeoutMs ?? 60_000),
      shell,
    });
    const output = [`exit=${result.exitCode}`, result.stdout, result.stderr].filter(Boolean).join("\n");
    return obs({
      call: input.call,
      ok: result.ok,
      output,
      durationMs: result.durationMs,
      blockedReason: result.blockedReason,
    });
  }
}

