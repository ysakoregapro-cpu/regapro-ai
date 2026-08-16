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

/**
 * Map persisted thread messages into the assistant UI model.
 * Citations must pass through — dropping them empties the right pane on reload.
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
      content: m.content,
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
