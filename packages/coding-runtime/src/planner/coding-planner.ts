import type { CodingMode, CodingModelRole, CodingPlan } from "../types.js";
import type { CodingIntentDecision } from "../types.js";

export function planCodingSession(input: {
  userText: string;
  intent: CodingIntentDecision;
  hasWorkspace: boolean;
  hasInternalKnowledge: boolean;
}): CodingPlan {
  const mode: CodingMode =
    input.intent.mode ?? (input.hasWorkspace ? "workspace" : "pasted");
  const complex =
    /architecture|設計|構成|複数ファイル|リファクタ|横断|組織/i.test(input.userText);
  const primaryRole: CodingModelRole = complex && mode !== "pasted" ? "reasoning" : "code";
  const steps =
    mode === "pasted"
      ? [
          "貼られたコードを言語・目的ごとに整理する",
          "説明 / 修正 / レビュー / 書き換えのどれかを実行する",
          "差分形式で結果を返す",
        ]
      : [
          "git status と workspace 概要を取る",
          "関連ファイルを search / read する",
          "apply_patch で最小修正する",
          "検出できた typecheck/lint/test/build を実行する",
          "git diff を返す",
        ];

  return {
    goal: input.userText.slice(0, 500),
    mode,
    steps,
    primaryRole,
    secondaryRole: primaryRole === "reasoning" ? "code" : "main",
    needInternalKnowledge: input.hasInternalKnowledge || /社内|方針|レガプロ|UI/.test(input.userText),
    needWorkspace: mode !== "pasted",
    verification: mode === "pasted" ? [] : ["git_status", "git_diff"],
  };
}

export function roleForIteration(input: {
  plan: CodingPlan;
  iteration: number;
  lastFailedVerification: boolean;
}): CodingModelRole {
  if (input.iteration === 0 && input.plan.primaryRole === "reasoning") return "reasoning";
  if (input.lastFailedVerification) return "code";
  return "code";
}
