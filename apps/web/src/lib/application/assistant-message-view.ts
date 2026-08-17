import type { StoredMessage } from "@/lib/application/chat-service";

export type AssistantCitationView = {
  id: string;
  title: string;
  source: string;
  excerpt?: string | null;
  uri?: string | null;
  provenance?: "internal" | "web";
};

export type AssistantMessageView = {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  citations?: readonly AssistantCitationView[];
};

function provenanceFromSource(
  source: string | undefined,
): "internal" | "web" | undefined {
  if (!source) return undefined;
  if (source === "web" || source === "research" || source === "外部情報") {
    return "web";
  }
  if (
    source === "knowledge" ||
    source === "knowledge_chunk" ||
    source === "社内情報"
  ) {
    return "internal";
  }
  // Domain-looking labels from persisted web citations.
  if (source.includes(".") && !source.includes(" ")) return "web";
  return undefined;
}

type MessageLike = {
  id: string;
  threadId: string;
  role: string;
  content: string;
  createdAt: string;
  citations?: StoredMessage["citations"];
};

const KNOWLEDGE_URI_RE =
  /knowledge:\/\/document\/[0-9a-f-]+\/chunk\/[0-9a-f-]+/gi;
const PAREN_GROUNDING_RE = /[（(]\s*根拠[:：][^）)]*[）)]/g;
const LINE_GROUNDING_RE = /(?:^|\n)\s*根拠[:：][^\n]*/g;

function sanitizeVisibleContent(text: string): string {
  return text
    .replace(KNOWLEDGE_URI_RE, "")
    .replace(PAREN_GROUNDING_RE, "")
    .replace(LINE_GROUNDING_RE, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Map persisted thread messages into the assistant UI model.
 * Citations must pass through — dropping them empties the right pane on reload.
 * Visible body strips internal URIs; structured citation.uri is kept for the pane.
 */
export function toAssistantMessages(
  messages: readonly MessageLike[],
): AssistantMessageView[] {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      id: m.id,
      threadId: m.threadId,
      role: m.role as "user" | "assistant",
      content: m.role === "assistant" ? sanitizeVisibleContent(m.content) : m.content,
      createdAt: m.createdAt,
      citations: (m.citations ?? []).map((c) => ({
        id: c.id,
        title: c.title,
        source: c.source,
        excerpt: c.excerpt ?? null,
        uri: "uri" in c ? (c.uri as string | null | undefined) ?? null : null,
        provenance: provenanceFromSource(c.source),
      })),
    }));
}

export function citationsForRightPane(input: {
  messageCitations: readonly AssistantCitationView[];
  researchCitations: readonly {
    id: string;
    title: string;
    publisher: string;
    url: string | null;
    excerpt: string;
  }[];
}): AssistantCitationView[] {
  if (input.messageCitations.length > 0) {
    return [...input.messageCitations];
  }
  return input.researchCitations.map((c) => ({
    id: c.id,
    title: c.title,
    source: c.publisher + (c.url ? ` · ${c.url}` : ""),
    excerpt: c.excerpt,
    uri: c.url,
    provenance: "web" as const,
  }));
}
