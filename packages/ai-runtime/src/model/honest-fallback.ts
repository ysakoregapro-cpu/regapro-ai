import type { ModelProvider } from "../ports.js";
import type { ModelGenerateInput, ModelGenerateOutput } from "../ports.js";

/**
 * Honest fallback when no LLM is connected.
 * Never claims search or reasoning ran when providers are disconnected.
 */
export class HonestFallbackModelProvider implements ModelProvider {
  readonly id = "honest-fallback" as const;
  readonly connected = false;

  async generate(input: ModelGenerateInput): Promise<ModelGenerateOutput> {
    const limitations: string[] = [];
    if (input.plan.needWeb && !input.context.items.some((i) => i.sourceType === "web")) {
      limitations.push("Web検索バックエンドは未接続のため、外部情報は参照していません。");
    }
    if (
      input.plan.needInternalKnowledge &&
      input.context.items.filter((i) => i.sourceType === "knowledge").length === 0
    ) {
      limitations.push("利用可能な社内ナレッジが見つかりませんでした（または未接続です）。");
    }
    if (input.plan.needDeepResearch) {
      limitations.push("Deep Research ワーカーはまだ接続されていません。");
    }

    if (input.hints?.researchSummary) {
      return {
        text: input.hints.researchSummary,
        confidence: 0.5,
        providerId: this.id,
        modelId: "honest-fallback",
        connected: false,
        limitations,
      };
    }
    if (input.hints?.artifactSummary) {
      return {
        text: input.hints.artifactSummary,
        confidence: 0.6,
        providerId: this.id,
        modelId: "honest-fallback",
        connected: false,
        limitations,
      };
    }
    if (input.hints?.taskSummary) {
      return {
        text: input.hints.taskSummary,
        confidence: 0.6,
        providerId: this.id,
        modelId: "honest-fallback",
        connected: false,
        limitations,
      };
    }

    const short =
      input.userText.replace(/\s+/g, " ").trim().slice(0, 40) +
      (input.userText.length > 40 ? "…" : "");

    const knowledgeLines =
      input.context.items.length > 0
        ? [
            "",
            "参照できた社内情報（抜粋）:",
            ...input.context.items.slice(0, 3).map((i) => `・${i.source}`),
          ]
        : [];

    const text = [
      `「${short}」という依頼を受け付けました。`,
      "",
      "現在は AI モデル本体が未接続です。検索や推論を実行したかのように装ってはいません。",
      ...limitations.map((l) => `・${l}`),
      ...knowledgeLines,
      "",
      "そのまま進められること:",
      "・タスクとして登録する",
      "・資料の下書き方針を指定する",
      "・関連プロジェクトを指定して詳しく依頼する",
    ].join("\n");

    return {
      text,
      confidence: 0.4,
      providerId: this.id,
      modelId: "honest-fallback",
      connected: false,
      limitations,
    };
  }
}

/**
 * Slot for Browser Local LLM — replace HonestFallback when downloaded/connected.
 * Kept as a thin adapter so IntentRouter / Answer pipeline stay unchanged.
 */
export class BrowserLocalModelProviderSlot implements ModelProvider {
  readonly id = "browser-local" as const;
  readonly connected = false;

  async generate(input: ModelGenerateInput): Promise<ModelGenerateOutput> {
    void input;
    return {
      text: "ブラウザ Local LLM はまだ接続されていません。",
      confidence: 0,
      providerId: this.id,
      modelId: "browser-local-unconnected",
      connected: false,
      limitations: ["Local LLM モデルは未ダウンロード / 未接続です。"],
    };
  }
}
