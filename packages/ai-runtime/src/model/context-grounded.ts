import type { ModelGenerateInput, ModelGenerateOutput, ModelProvider } from "../ports.js";

/**
 * Compose an answer from already-retrieved context. Does not call an LLM
 * and does not claim that search or reasoning ran.
 */
export class ContextGroundedModelProvider implements ModelProvider {
  readonly id = "rules-template" as const;
  readonly connected = true;

  async generate(input: ModelGenerateInput): Promise<ModelGenerateOutput> {
    const internals = input.context.items.filter(
      (i) => i.sourceType === "knowledge" || i.sourceType === "knowledge_chunk",
    );
    const web = input.context.items.filter(
      (i) => i.sourceType === "web" || i.sourceType === "research",
    );

    if (internals.length === 0 && web.length === 0) {
      return {
        text: "確認できる社内Knowledgeがありません。",
        confidence: 0.35,
        providerId: this.id,
        modelId: "context-grounded",
        connected: true,
        limitations: ["追加の生成モデルは使っていません。"],
      };
    }

    const lines = [
      "参照できた情報に基づく整理です（追加の生成モデルは使っていません）。",
      "",
    ];
    if (internals.length) {
      lines.push("社内情報:");
      for (const i of internals.slice(0, 5)) {
        lines.push(`・${i.source}: ${i.content.slice(0, 180)}`);
      }
      lines.push("");
    }
    if (web.length) {
      lines.push("公開情報:");
      for (const i of web.slice(0, 5)) {
        lines.push(`・${i.source}: ${i.content.slice(0, 180)}`);
      }
    }

    return {
      text: lines.join("\n").trim(),
      confidence: 0.7,
      providerId: this.id,
      modelId: "context-grounded",
      connected: true,
      limitations: [],
      role: null,
      fallbackCount: 0,
    };
  }
}
