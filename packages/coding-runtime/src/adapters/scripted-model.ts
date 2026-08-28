import type { CodingModelPort, CodingModelTurnInput, CodingModelTurnOutput } from "../ports.js";
import type { ToolCall, ToolName } from "../types.js";

export type ScriptedTurn =
  | { toolCalls: Array<{ name: ToolName; arguments?: Record<string, unknown> }> }
  | { text: string };

/**
 * Deterministic model for tests. Never calls a provider.
 */
export class ScriptedCodingModel implements CodingModelPort {
  private index = 0;
  constructor(private readonly turns: ScriptedTurn[]) {}

  async complete(_input: CodingModelTurnInput): Promise<CodingModelTurnOutput> {
    const turn = this.turns[this.index] ?? { text: '{"type":"finish","text":"完了"}' };
    this.index += 1;
    if ("text" in turn) {
      return {
        text: turn.text,
        toolCalls: [],
        modelId: "scripted",
        role: "code",
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        estimatedCostUsd: 0,
      };
    }
    const toolCalls: ToolCall[] = turn.toolCalls.map((c, i) => ({
      id: `scripted_${this.index}_${i}`,
      name: c.name,
      arguments: c.arguments ?? {},
    }));
    return {
      text: null,
      toolCalls,
      modelId: "scripted",
      role: "code",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      estimatedCostUsd: 0,
    };
  }
}
