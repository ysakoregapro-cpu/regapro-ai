import type { CodingIntentDecision, CodingLanguage, PastedCodeBlock } from "../types.js";

const FENCE_RE = /```([a-zA-Z0-9_+-]*)\r?\n([\s\S]*?)```/g;

const GAS_MARKERS =
  /\b(SpreadsheetApp|DriveApp|FormApp|DocumentApp|GmailApp|CalendarApp|UrlFetchApp|ScriptApp|HtmlService|PropertiesService|LockService|CacheApp|Session\.getActiveUser|onOpen\s*\(|onEdit\s*\()\b/;

const LANGUAGE_HINTS: Array<{ re: RegExp; language: CodingLanguage; filename: string }> = [
  { re: GAS_MARKERS, language: "gas", filename: "Code.gs" },
  { re: /\b(from ['"]react['"]|next\/(navigation|headers)|useState\s*\()/, language: "tsx", filename: "component.tsx" },
  { re: /\b(import\s+type\s+|:\s*(string|number|boolean|void)\b|interface\s+\w+)/, language: "typescript", filename: "snippet.ts" },
  { re: /\b(SELECT\s+.+\s+FROM|INSERT\s+INTO|CREATE\s+TABLE)\b/i, language: "sql", filename: "query.sql" },
  { re: /\b(param\s*\(|Get-ChildItem|Write-Host|\$PSVersionTable)\b/i, language: "powershell", filename: "script.ps1" },
  { re: /\b(def\s+\w+\s*\(|import\s+os|from\s+\w+\s+import)\b/, language: "python", filename: "snippet.py" },
  { re: /\b(function\s+\w+\s*\(|const\s+\w+\s*=|=>\s*\{)/, language: "javascript", filename: "snippet.js" },
];

const FENCE_LANG: Record<string, { language: CodingLanguage; filename: string }> = {
  js: { language: "javascript", filename: "snippet.js" },
  javascript: { language: "javascript", filename: "snippet.js" },
  ts: { language: "typescript", filename: "snippet.ts" },
  typescript: { language: "typescript", filename: "snippet.ts" },
  tsx: { language: "tsx", filename: "component.tsx" },
  jsx: { language: "tsx", filename: "component.jsx" },
  py: { language: "python", filename: "snippet.py" },
  python: { language: "python", filename: "snippet.py" },
  sql: { language: "sql", filename: "query.sql" },
  ps1: { language: "powershell", filename: "script.ps1" },
  powershell: { language: "powershell", filename: "script.ps1" },
  gs: { language: "gas", filename: "Code.gs" },
  gas: { language: "gas", filename: "Code.gs" },
};

function detectLanguage(code: string, fenceLang?: string): {
  language: CodingLanguage;
  filename: string;
} {
  const fromFence = fenceLang ? FENCE_LANG[fenceLang.toLowerCase()] : undefined;
  if (fromFence) {
    if (fromFence.language !== "gas" && GAS_MARKERS.test(code)) {
      return { language: "gas", filename: "Code.gs" };
    }
    return fromFence;
  }
  for (const hint of LANGUAGE_HINTS) {
    if (hint.re.test(code)) return { language: hint.language, filename: hint.filename };
  }
  return { language: "unknown", filename: "snippet.txt" };
}

export function extractPastedBlocks(text: string): PastedCodeBlock[] {
  const blocks: PastedCodeBlock[] = [];
  for (const match of text.matchAll(FENCE_RE)) {
    const lang = match[1] ?? "";
    const code = (match[2] ?? "").replace(/\s+$/, "");
    if (code.trim().length < 8) continue;
    const detected = detectLanguage(code, lang);
    blocks.push({
      language: detected.language,
      filenameHint: detected.filename,
      code,
    });
  }
  if (blocks.length === 0 && GAS_MARKERS.test(text) && text.length > 40) {
    const detected = detectLanguage(text);
    blocks.push({
      language: detected.language,
      filenameHint: detected.filename,
      code: text,
    });
  }
  return blocks;
}

const WORKSPACE_PATH =
  /(?:[A-Za-z]:\\[^\s]+|\/(?:Users|home|opt|var|src)\/[^\s]+|workspace|リポジトリ|repository)/i;

const CODING_VERBS =
  /直して|修正して|リファクタ|バグ|実装して|レビューして|書き換えて|生成して|vibe|apply_patch|typecheck|コード/;

const STRONG_CODE =
  /```|SpreadsheetApp|DriveApp|FormApp|TypeScript|JavaScript|PowerShell|Next\.js|GAS|Apps Script/;

export function classifyCodingIntent(text: string): CodingIntentDecision {
  const trimmed = text.trim();
  const pastedBlocks = extractPastedBlocks(trimmed);
  const hasFence = pastedBlocks.length > 0;
  const hasWorkspace = WORKSPACE_PATH.test(trimmed);
  const hasVerb = CODING_VERBS.test(trimmed);
  const strong = STRONG_CODE.test(trimmed) || hasFence;

  if (!strong && !hasVerb && !hasWorkspace) {
    return {
      isCoding: false,
      mode: null,
      language: null,
      reason: "not_coding",
      confidence: 0.2,
      requiresWorkspace: false,
      pastedBlocks,
    };
  }

  const language = pastedBlocks[0]?.language ?? detectLanguage(trimmed).language;

  if (hasFence && !hasWorkspace) {
    return {
      isCoding: true,
      mode: "pasted",
      language,
      reason: language === "gas" ? "pasted_gas" : "pasted_code",
      confidence: 0.93,
      requiresWorkspace: false,
      pastedBlocks,
    };
  }

  if (GAS_MARKERS.test(trimmed) && !hasWorkspace) {
    return {
      isCoding: true,
      mode: "pasted",
      language: "gas",
      reason: "gas_markers",
      confidence: 0.9,
      requiresWorkspace: false,
      pastedBlocks: pastedBlocks.length
        ? pastedBlocks
        : [{ language: "gas", filenameHint: "Code.gs", code: trimmed }],
    };
  }

  if (hasWorkspace && (hasVerb || strong)) {
    const vibe =
      /直して|実装|テスト|typecheck|lint|build|直して|なおして|vibe|Agent/i.test(trimmed);
    return {
      isCoding: true,
      mode: vibe ? "vibe" : "workspace",
      language,
      reason: vibe ? "vibe_workspace" : "workspace_inspect",
      confidence: 0.88,
      requiresWorkspace: true,
      pastedBlocks,
    };
  }

  if (strong || hasVerb) {
    return {
      isCoding: true,
      mode: "pasted",
      language,
      reason: "code_request",
      confidence: 0.8,
      requiresWorkspace: false,
      pastedBlocks,
    };
  }

  return {
    isCoding: false,
    mode: null,
    language: null,
    reason: "not_coding",
    confidence: 0.3,
    requiresWorkspace: false,
    pastedBlocks,
  };
}
