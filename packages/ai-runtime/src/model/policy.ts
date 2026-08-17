import type { AnswerIntent } from "../types.js";
import type { ModelRole } from "./roles.js";

export type RoutingSignals = {
  intent: AnswerIntent;
  simpleLookup: boolean;
  structureRequest: boolean;
  complexSynthesis: boolean;
  codeRequest: boolean;
  visionRequest: boolean;
  hasInternalEvidence: boolean;
  hasWebEvidence: boolean;
};

export type ModelRoute = {
  role: ModelRole | null;
  skipLlm: boolean;
  secondaryRole: ModelRole | null;
  reason: string;
};

type RouteRule = {
  id: string;
  when: (s: RoutingSignals) => boolean;
  route: Omit<ModelRoute, "reason"> & { reason?: string };
};

const RULES: RouteRule[] = [
  {
    id: "vision",
    when: (s) => s.visionRequest || s.intent === "file_review",
    route: { role: "vision", skipLlm: false, secondaryRole: "main" },
  },
  {
    id: "code",
    when: (s) => s.codeRequest || s.intent === "code",
    route: { role: "code", skipLlm: false, secondaryRole: "main" },
  },
  {
    id: "reasoning",
    when: (s) =>
      s.complexSynthesis || s.intent === "deep_research",
    route: { role: "reasoning", skipLlm: false, secondaryRole: "main" },
  },
  {
    id: "skip-llm-zero-internal",
    when: (s) =>
      s.intent === "internal_knowledge" &&
      !s.hasInternalEvidence &&
      !s.hasWebEvidence &&
      !s.complexSynthesis,
    route: { role: null, skipLlm: true, secondaryRole: "fast" },
  },
  {
    id: "skip-llm-lookup",
    when: (s) =>
      s.simpleLookup &&
      s.hasInternalEvidence &&
      (s.intent === "internal_knowledge" || s.intent === "general"),
    route: { role: "main", skipLlm: false, secondaryRole: "fast" },
  },
  {
    id: "fast-structure",
    when: (s) => s.structureRequest,
    route: { role: "fast", skipLlm: false, secondaryRole: "main" },
  },
  {
    id: "main-prose",
    when: (s) =>
      s.intent === "document" ||
      s.intent === "web_search" ||
      s.intent === "general" ||
      s.intent === "internal_knowledge" ||
      s.intent === "task",
    route: { role: "main", skipLlm: false, secondaryRole: "fast" },
  },
];

export class ModelPolicy {
  route(signals: RoutingSignals): ModelRoute {
    for (const rule of RULES) {
      if (rule.when(signals)) {
        return { ...rule.route, reason: rule.route.reason ?? rule.id };
      }
    }
    return {
      role: "main",
      skipLlm: false,
      secondaryRole: "fast",
      reason: "default_main",
    };
  }
}

export function extractRoutingSignals(input: {
  intent: AnswerIntent;
  text: string;
  hasInternalEvidence: boolean;
  hasWebEvidence: boolean;
}): RoutingSignals {
  const text = input.text;
  const visionRequest = /画像|PDF|スクリーンショット|このファイルを見て/.test(text);
  const codeRequest =
    /TypeScript|GAS|SQL|architecture|リファクタ|実装して|コード/.test(text);
  const complexSynthesis =
    /分析|比較|統合|組織案|複数|来期|経営|課題を整理|3案|トレードオフ/.test(text);
  const structureRequest =
    /構造化|JSON|箇条書きにして|項目に分けて|フォーマット/.test(text);
  const simpleLookup =
    !complexSynthesis &&
    !structureRequest &&
    !codeRequest &&
    text.length < 80 &&
    /教えて|確認|何|どこ|いつ|誰/.test(text);

  return {
    intent: input.intent,
    simpleLookup,
    structureRequest,
    complexSynthesis,
    codeRequest,
    visionRequest,
    hasInternalEvidence: input.hasInternalEvidence,
    hasWebEvidence: input.hasWebEvidence,
  };
}
