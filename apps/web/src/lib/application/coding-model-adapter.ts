import type { AccessContext } from "@regapro/security";
import type {
  ModelGenerateInput,
  ModelGenerateOutput,
  ModelProvider,
} from "@regapro/ai-runtime";
import type {
  CodingModelPort,
  CodingModelTurnInput,
  CodingModelTurnOutput,
  ToolCall,
  ToolName,
} from "@regapro/coding-runtime";

function parseJsonProtocol(text: string | null): {
  finishText: string | null;
  calls: ToolCall[];
} {
  if (!text) return { finishText: null, calls: [] };
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) return { finishText: trimmed, calls: [] };
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as {
      type?: string;
      text?: string;
      calls?: Array<{ id?: string; name?: string; arguments?: Record<string, unknown> }>;
    };
    if (parsed.type === "tool_calls" && Array.isArray(parsed.calls)) {
      return {
        finishText: null,
        calls: parsed.calls.map((c, i) => ({
          id: c.id ?? `t${i}`,
          name: c.name as ToolName,
          arguments: c.arguments ?? {},
        })),
      };
    }
    if (parsed.type === "finish") {
      return { finishText: parsed.text ?? "", calls: [] };
    }
  } catch {
    return { finishText: trimmed, calls: [] };
  }
  return { finishText: trimmed, calls: [] };
}

/**
 * Bridges ModelProvider (REGAPRO_MODEL_CODE via FallbackChain) into Coding Runtime.
 * Provider ids stay in ai-runtime — this adapter does not hardcode vendors.
 */
export class ModelProviderCodingAdapter implements CodingModelPort {
  constructor(
    private readonly provider: ModelProvider,
    private readonly access: AccessContext,
  ) {}

  async complete(input: CodingModelTurnInput): Promise<CodingModelTurnOutput> {
    const toolList = input.tools
      .map((t) => `- ${t.name} (${t.riskLevel}): ${t.description}`)
      .join("\n");
    const history = input.messages
      .map((m) => `[${m.role}] ${m.content.slice(0, 4000)}`)
      .join("\n\n")
      .slice(0, 24_000);

    const generateInput: ModelGenerateInput = {
      access: this.access,
      userText: history,
      context: {
        items: [],
        ceiling: this.access.threadConfidentialityLevel,
        rejectedCount: 0,
        budgetHints: { maxItems: 0, maxChars: 0 },
      },
      plan: {
        intent: "code",
        needInternalKnowledge: false,
        needWeb: false,
        needDeepResearch: false,
        needProjectContext: false,
        needDepartmentContext: false,
        needCitations: false,
        needToolExecution: true,
        includePrivateConversations: false,
        includeAuditCases: false,
      },
      intent: {
        intent: "code",
        confidence: 1,
        reason: "coding_runtime",
        provider: "rules",
        codingMode: "pasted",
      },
      role: input.role,
      systemOverride: `You are the RegaloProfessional Coding Agent.\n${toolList}\nReply with JSON {"type":"tool_calls","calls":[...]} or {"type":"finish","text":"..."}.`,
      tools: input.tools.map((t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      })),
      conversation: input.messages.map((m) => ({
        role: m.role,
        content: m.content,
        toolCallId: m.toolCallId,
      })),
    };

    const out: ModelGenerateOutput = await this.provider.generate(generateInput);
    if (out.toolCalls?.length) {
      return {
        text: out.text,
        toolCalls: out.toolCalls.map((c) => ({
          id: c.id,
          name: c.name as ToolName,
          arguments: c.arguments,
        })),
        modelId: out.modelId,
        role: input.role,
        usage: out.usage ?? null,
        estimatedCostUsd: out.estimatedCostUsd ?? null,
      };
    }
    const parsed = parseJsonProtocol(out.text);
    return {
      text: parsed.finishText ?? out.text,
      toolCalls: parsed.calls,
      modelId: out.modelId,
      role: input.role,
      usage: out.usage ?? null,
      estimatedCostUsd: out.estimatedCostUsd ?? null,
    };
  }
}
