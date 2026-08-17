export type TranscriptMessage = {
  role: "user" | "assistant" | "system" | "expert" | string;
  speaker?: string | null;
  content: string;
  timestamp?: string | null;
};

export type StructuredTranscript = {
  title?: string;
  conversationId?: string | null;
  messages: TranscriptMessage[];
};

export type TranscriptIngestPort = {
  parse(raw: unknown): StructuredTranscript;
};

const PERSONAL_SKIP =
  /健康|病歴|宗教|政治|忠誠|内部告発|プライベート|私生活|恋愛|愚痴/;

/**
 * Format-agnostic transcript port. Does not depend on a vendor export schema.
 */
export class GenericTranscriptIngestPort implements TranscriptIngestPort {
  parse(raw: unknown): StructuredTranscript {
    if (!raw || typeof raw !== "object") {
      return { messages: [] };
    }
    const obj = raw as Record<string, unknown>;
    const title = typeof obj.title === "string" ? obj.title : undefined;
    const conversationId =
      typeof obj.conversationId === "string"
        ? obj.conversationId
        : typeof obj.id === "string"
          ? obj.id
          : null;
    const list = Array.isArray(obj.messages) ? obj.messages : [];
    const messages: TranscriptMessage[] = [];
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const m = item as Record<string, unknown>;
      const content = typeof m.content === "string" ? m.content : "";
      if (!content.trim()) continue;
      messages.push({
        role: typeof m.role === "string" ? m.role : "user",
        speaker: typeof m.speaker === "string" ? m.speaker : null,
        content,
        timestamp: typeof m.timestamp === "string" ? m.timestamp : null,
      });
    }
    return { title, conversationId, messages };
  }
}

export function transcriptToReusableText(input: StructuredTranscript): string {
  const lines: string[] = [];
  for (const m of input.messages) {
    if (PERSONAL_SKIP.test(m.content)) continue;
    const who = m.speaker || m.role;
    lines.push(`${who}: ${m.content}`);
  }
  return lines.join("\n\n");
}
