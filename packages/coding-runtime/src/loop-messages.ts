import type { CodingModelRole, ToolCall } from "./types.js";

export type CodingChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
  name?: string;
};

export type { CodingModelRole };
