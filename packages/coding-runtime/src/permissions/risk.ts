import type { ToolRiskLevel, ToolName } from "../types.js";

const DANGEROUS_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\bgit\s+reset\s+--hard\b/i, reason: "git_reset_hard" },
  { re: /\bgit\s+clean\b/i, reason: "git_clean" },
  { re: /\bgit\s+push\b[^\n]*--force\b/i, reason: "force_push" },
  { re: /\bgit\s+push\s+-f\b/i, reason: "force_push" },
  { re: /\bgit\s+checkout\s+-f\b/i, reason: "force_checkout" },
  { re: /\brm\s+-rf\b/i, reason: "recursive_delete" },
  { re: /\bRemove-Item\b[^\n]*-Recurse/i, reason: "recursive_delete" },
  { re: /\bDROP\s+(TABLE|DATABASE)\b/i, reason: "production_db_mutation" },
  { re: /\bTRUNCATE\b/i, reason: "production_db_mutation" },
  { re: /\bDELETE\s+FROM\b/i, reason: "production_db_mutation" },
  { re: /\b(supabase\s+db\s+push|prisma\s+migrate\s+deploy)\b/i, reason: "production_db_mutation" },
  { re: /\b(AWS_|SECRET|SERVICE_ROLE|PRIVATE_KEY|AI_GATEWAY_API_KEY)\b/, reason: "secret_env_mutation" },
  { re: /\bSet-Item\s+Env:/i, reason: "secret_env_mutation" },
];

const WRITE_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\bgit\s+commit\b/i, reason: "git_commit" },
  { re: /\bgit\s+push\b/i, reason: "git_push" },
  { re: /\bnpm\s+install\b/i, reason: "dependency_mutation" },
  { re: /\bgit\s+add\b/i, reason: "git_add" },
];

export function classifyCommandRisk(command: string): {
  risk: ToolRiskLevel;
  reason: string | null;
  autoForbidden: boolean;
} {
  const text = command.trim();
  for (const p of DANGEROUS_PATTERNS) {
    if (p.re.test(text)) {
      return { risk: "dangerous", reason: p.reason, autoForbidden: true };
    }
  }
  for (const p of WRITE_PATTERNS) {
    if (p.re.test(text)) {
      const approvalRequired = p.reason === "git_commit" || p.reason === "git_push";
      return {
        risk: approvalRequired ? "dangerous" : "write",
        reason: p.reason,
        autoForbidden: approvalRequired,
      };
    }
  }
  return { risk: "read", reason: null, autoForbidden: false };
}

export function toolRequiresExplicitApproval(
  name: ToolName,
  args: Record<string, unknown>,
): boolean {
  if (name === "run_command" || name === "run_powershell") {
    const cmd = String(args.command ?? args.script ?? "");
    return classifyCommandRisk(cmd).autoForbidden;
  }
  if (name === "git_checkout") {
    return Boolean(args.force) || String(args.branch ?? "").startsWith("-");
  }
  return name === "rename_file" && Boolean(args.overwrite);
}

export function riskLabel(level: ToolRiskLevel): "READ" | "WRITE" | "DANGEROUS" {
  if (level === "read") return "READ";
  if (level === "write") return "WRITE";
  return "DANGEROUS";
}
